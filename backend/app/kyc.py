import os
import json
import subprocess
from uuid import uuid4
from loguru import logger

from app.zk.witness_builder import build_witness_from_ocr, WitnessBuildError

# Compiled circuit artifacts (output of `circom kyc.circom --r1cs --wasm` +
# snarkjs groth16 setup with the Powers-of-Tau ceremony file).
CIRCUIT_DIR = "app/zk/build"
WASM_PATH = f"{CIRCUIT_DIR}/kyc_js/kyc.wasm"
ZKEY_PATH = f"{CIRCUIT_DIR}/kyc_final.zkey"


def generate_kyc_proof(ocr_result: dict) -> dict:
    """
    Generates a Groth16 ZK proof attesting to:
      - age >= 18 (configurable)
      - nationality not in restricted-country list (Merkle non-membership)
      - document issued within the allowed freshness window

    `ocr_result` is the dict returned by app.ocr.extract_document_fields(...)
    — this function derives ALL circuit inputs from it; nothing is faked
    or hardcoded the way the old stub version did.

    Returns {"success": True, "proof": ..., "public": [...]} on success, or
    {"success": False, "error": "..."} if the document fails a predicate
    (e.g. underage, restricted nationality, expired doc) or proving fails.
    """
    try:
        witness = build_witness_from_ocr(ocr_result)
    except WitnessBuildError as e:
        logger.warning(f"KYC predicate check failed before proving: {e}")
        return {"success": False, "error": str(e)}

    temp_id = str(uuid4())
    input_file = f"/tmp/{temp_id}_input.json"
    proof_file = f"/tmp/{temp_id}_proof.json"
    public_file = f"/tmp/{temp_id}_public.json"

    with open(input_file, "w") as f:
        json.dump(witness, f)

    try:
        cmd = [
            "snarkjs", "groth16", "fullprove",
            input_file, WASM_PATH, ZKEY_PATH,
            proof_file, public_file,
        ]
        subprocess.run(cmd, capture_output=True, text=True, check=True)

        with open(proof_file, "r") as pf, open(public_file, "r") as pubf:
            proof_data = json.load(pf)
            public_data = json.load(pubf)

        logger.info(f"ZK Proof generated | nullifier={public_data[0]}")

        return {
            "success": True,
            "proof": proof_data,
            # public signal order matches circuit `main` declaration:
            # [nullifier, current_timestamp, min_age_seconds, restricted_root, doc_max_age_seconds]
            "public": public_data,
        }

    except subprocess.CalledProcessError as e:
        logger.error(f"ZK Proving failed: {e.stderr}")
        return {
            "success": False,
            "error": "Proof generation failed — document may not satisfy KYC criteria.",
        }

    finally:
        for file in [input_file, proof_file, public_file]:
            if os.path.exists(file):
                os.remove(file)
