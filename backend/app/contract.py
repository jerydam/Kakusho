"""
contract.py (Stellar/Soroban version)

Replaces the web3.py + EVM contract.py: instead of calling setVerified/
mintSBT on an EVM contract via a private-key-holding operator account,
this invokes the kyc_verifier Soroban contract directly.

Key differences from the EVM version:
  - No "operator" relayer key needed for verify_and_mint — the recipient
    signs their own transaction (`recipient.require_auth()` in the
    contract), since Soroban auth doesn't require gas-paying-on-behalf-of
    patterns the way the old EVM flow did. If you DO want a backend-paid
    relay (better UX — user doesn't need testnet XLM), use the Stellar
    SDK's fee-bump / sponsored-reserve pattern; see `submit_sponsored_tx`
    below for a sketch.
  - chain_id is gone; Soroban network selection is via the RPC URL +
    network passphrase instead.
"""
from stellar_sdk import (
    Keypair,
    TransactionBuilder,
    Network,
    SorobanServer,
    scval,
)
from stellar_sdk.exceptions import PrepareTransactionException
from app.core.config import settings
from loguru import logger
from typing import Optional


def get_soroban_server() -> SorobanServer:
    return SorobanServer(settings.STELLAR_RPC_URL)  # e.g. https://soroban-testnet.stellar.org


def get_network_passphrase() -> str:
    return (
        Network.TESTNET_NETWORK_PASSPHRASE
        if settings.STELLAR_NETWORK == "testnet"
        else Network.PUBLIC_NETWORK_PASSPHRASE
    )


async def is_verified_onchain(stellar_address: str) -> bool:
    """Read-only check of on-chain verification status (simulation only, no fee)."""
    try:
        server = get_soroban_server()
        source = server.load_account(settings.OPERATOR_STELLAR_ADDRESS)

        tx = (
            TransactionBuilder(
                source_account=source,
                network_passphrase=get_network_passphrase(),
                base_fee=100,
            )
            .add_time_bounds(0, 0)
            .append_invoke_contract_function_op(
                contract_id=settings.KYC_CONTRACT_ID,
                function_name="is_verified",
                parameters=[scval.to_address(stellar_address)],
            )
            .build()
        )

        sim = server.simulate_transaction(tx)
        if sim.error:
            logger.error(f"is_verified simulation error: {sim.error}")
            return False

        result_scval = sim.results[0].xdr
        return scval.from_bool(scval.parse_to_native(result_scval))

    except Exception as e:
        logger.error(f"isVerified read error: {e}")
        return False


async def submit_sponsored_verify_and_mint(
    recipient_address: str,
    proof: dict,
    public_signals: list[str],
) -> Optional[str]:
    """
    Backend-sponsored relay of verify_and_mint, for users with no XLM for
    fees. Requires the recipient to have pre-signed an authorization entry
    (Soroban's `require_auth` supports this via signed auth entries passed
    alongside the tx — the recipient signs an auth payload client-side,
    the backend wraps it in a fee-bump transaction it pays for itself).

    This is the Stellar-native equivalent of the old EVM "operator relayer"
    pattern in mark_verified_onchain/mint_sbt. Sketch only — fill in
    auth-entry construction with stellar_sdk's `authorize_entry` helper
    once you have the client-side proof + signed entry flow wired up.
    """
    if not settings.OPERATOR_STELLAR_SECRET:
        logger.warning("No operator secret configured — skipping sponsored relay")
        return None

    try:
        server = get_soroban_server()
        operator_kp = Keypair.from_secret(settings.OPERATOR_STELLAR_SECRET)
        source = server.load_account(operator_kp.public_key)

        # Convert proof + public_signals (decimal strings from snarkjs) into
        # the ScVal shapes expected by the Soroban contract's Proof / Vec<Bn254Fr>
        # types. The exact encoding depends on your generated contract bindings
        # (see scripts/encode_proof.py) — omitted here for brevity.
        proof_scval = scval.to_struct({})  # TODO: build from `proof` via encode_proof.py
        signals_scval = scval.to_vec([])   # TODO: build from `public_signals`

        tx = (
            TransactionBuilder(
                source_account=source,
                network_passphrase=get_network_passphrase(),
                base_fee=10_000,
            )
            .add_time_bounds(0, 0)
            .append_invoke_contract_function_op(
                contract_id=settings.KYC_CONTRACT_ID,
                function_name="verify_and_mint",
                parameters=[
                    scval.to_address(recipient_address),
                    proof_scval,
                    signals_scval,
                ],
            )
            .build()
        )

        prepared = server.prepare_transaction(tx)
        prepared.sign(operator_kp)
        # NOTE: recipient's signed auth entry must also be attached to
        # `prepared` here via add_auth_entries(...) before submission.

        send_resp = server.send_transaction(prepared)
        logger.info(f"verify_and_mint submitted: {send_resp.hash}")
        return send_resp.hash

    except PrepareTransactionException as e:
        logger.error(f"Soroban tx prep failed: {e}")
        return None
    except Exception as e:
        logger.error(f"verify_and_mint relay error: {e}")
        return None
