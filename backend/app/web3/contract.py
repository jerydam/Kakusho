from web3 import Web3
from web3.middleware import geth_poa_middleware
from eth_account import Account
from app.core.config import settings
from loguru import logger
from typing import Optional

# KYC Verifier ABI (matches the Solidity contract below)
KYC_ABI = [
    {
        "inputs": [{"name": "user", "type": "address"}],
        "name": "setVerified",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function",
    },
    {
        "inputs": [{"name": "user", "type": "address"}],
        "name": "revokeVerification",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function",
    },
    {
        "inputs": [{"name": "user", "type": "address"}],
        "name": "isVerified",
        "outputs": [{"name": "", "type": "bool"}],
        "stateMutability": "view",
        "type": "function",
    },
    {
        "inputs": [{"name": "user", "type": "address"}],
        "name": "mintSBT",
        "outputs": [{"name": "tokenId", "type": "uint256"}],
        "stateMutability": "nonpayable",
        "type": "function",
    },
]


def get_web3() -> Web3:
    w3 = Web3(Web3.HTTPProvider(settings.RPC_URL))
    w3.middleware_onion.inject(geth_poa_middleware, layer=0)
    return w3


def get_contract():
    if not settings.KYC_CONTRACT_ADDRESS:
        raise ValueError("KYC_CONTRACT_ADDRESS not configured")
    w3 = get_web3()
    return w3.eth.contract(
        address=Web3.to_checksum_address(settings.KYC_CONTRACT_ADDRESS),
        abi=KYC_ABI,
    )


async def mark_verified_onchain(wallet_address: str) -> Optional[str]:
    """
    Calls setVerified() on the KYC contract.
    Returns the transaction hash on success, None on failure.
    """
    if not settings.OPERATOR_PRIVATE_KEY:
        logger.warning("No operator key configured — skipping on-chain verification")
        return None

    try:
        w3 = get_web3()
        contract = get_contract()
        operator = Account.from_key(settings.OPERATOR_PRIVATE_KEY)
        checksum_wallet = Web3.to_checksum_address(wallet_address)

        nonce = w3.eth.get_transaction_count(operator.address)
        gas_price = w3.eth.gas_price

        tx = contract.functions.setVerified(checksum_wallet).build_transaction({
            "from": operator.address,
            "nonce": nonce,
            "gas": 100_000,
            "gasPrice": gas_price,
            "chainId": settings.CHAIN_ID,
        })

        signed = w3.eth.account.sign_transaction(tx, settings.OPERATOR_PRIVATE_KEY)
        tx_hash = w3.eth.send_raw_transaction(signed.rawTransaction)
        receipt = w3.eth.wait_for_transaction_receipt(tx_hash, timeout=120)

        if receipt.status == 1:
            logger.info(f"On-chain verified: {wallet_address} | tx: {tx_hash.hex()}")
            return tx_hash.hex()
        else:
            logger.error(f"On-chain tx failed for {wallet_address}")
            return None

    except Exception as e:
        logger.error(f"on-chain verification error: {e}")
        return None


async def mint_sbt(wallet_address: str) -> Optional[dict]:
    """
    Mints a Soulbound Token for a verified user.
    Returns {"tx_hash": str, "token_id": str} on success.
    """
    if not settings.OPERATOR_PRIVATE_KEY:
        logger.warning("No operator key — skipping SBT mint")
        return None

    try:
        w3 = get_web3()
        contract = get_contract()
        operator = Account.from_key(settings.OPERATOR_PRIVATE_KEY)
        checksum_wallet = Web3.to_checksum_address(wallet_address)

        nonce = w3.eth.get_transaction_count(operator.address)
        tx = contract.functions.mintSBT(checksum_wallet).build_transaction({
            "from": operator.address,
            "nonce": nonce,
            "gas": 200_000,
            "gasPrice": w3.eth.gas_price,
            "chainId": settings.CHAIN_ID,
        })

        signed = w3.eth.account.sign_transaction(tx, settings.OPERATOR_PRIVATE_KEY)
        tx_hash = w3.eth.send_raw_transaction(signed.rawTransaction)
        receipt = w3.eth.wait_for_transaction_receipt(tx_hash, timeout=120)

        if receipt.status == 1:
            # Parse token ID from Transfer event logs
            token_id = None
            for log in receipt.logs:
                if len(log.topics) >= 4:
                    token_id = int(log.topics[3].hex(), 16)
                    break

            logger.info(f"SBT minted for {wallet_address} | tokenId: {token_id}")
            return {"tx_hash": tx_hash.hex(), "token_id": str(token_id)}

        return None

    except Exception as e:
        logger.error(f"SBT mint error: {e}")
        return None


async def is_verified_onchain(wallet_address: str) -> bool:
    """Read-only check of on-chain verification status."""
    try:
        contract = get_contract()
        checksum_wallet = Web3.to_checksum_address(wallet_address)
        return contract.functions.isVerified(checksum_wallet).call()
    except Exception as e:
        logger.error(f"isVerified read error: {e}")
        return False