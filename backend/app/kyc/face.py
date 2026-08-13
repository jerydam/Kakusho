"""
face.py — Real liveness detection using MediaPipe FaceLandmarker (Tasks API).
Compatible with mediapipe >= 0.10.x
"""
import cv2
import numpy as np
import mediapipe as mp
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision as mp_vision
from mediapipe.tasks.python.components.containers import NormalizedLandmark
import urllib.request
import os
from pathlib import Path
from typing import Optional, Tuple
from loguru import logger

# ─── Download model if missing ────────────────────────────────────────────────
MODEL_PATH = Path(__file__).parent / "face_landmarker.task"
MODEL_URL = (
    "https://storage.googleapis.com/mediapipe-models/face_landmarker/"
    "face_landmarker/float16/latest/face_landmarker.task"
)

def _ensure_model():
    if not MODEL_PATH.exists():
        logger.info(f"Downloading FaceLandmarker model to {MODEL_PATH}...")
        urllib.request.urlretrieve(MODEL_URL, MODEL_PATH)
        logger.info("Model downloaded.")

_ensure_model()

# ─── Landmark indices ─────────────────────────────────────────────────────────
NOSE_TIP    = 1
CHIN        = 199
LEFT_EYE    = 33
RIGHT_EYE   = 263
MOUTH_LEFT  = 61
MOUTH_RIGHT = 291

# ─── Head pose estimation ─────────────────────────────────────────────────────

def _get_head_pose(image_path: str) -> Optional[Tuple[float, float, float]]:
    """Returns (yaw, pitch, roll) in degrees. yaw>0=right, pitch>0=down."""
    img = cv2.imread(image_path)
    if img is None:
        return None

    h, w = img.shape[:2]
    rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)

    base_opts = mp_python.BaseOptions(model_asset_path=str(MODEL_PATH))
    opts = mp_vision.FaceLandmarkerOptions(
        base_options=base_opts,
        num_faces=1,
        min_face_detection_confidence=0.5,
        min_face_presence_confidence=0.5,
    )

    with mp_vision.FaceLandmarker.create_from_options(opts) as detector:
        result = detector.detect(mp_image)

    if not result.face_landmarks:
        return None

    lm = result.face_landmarks[0]

    image_points = np.array([
        [lm[NOSE_TIP].x * w,    lm[NOSE_TIP].y * h],
        [lm[CHIN].x * w,        lm[CHIN].y * h],
        [lm[LEFT_EYE].x * w,    lm[LEFT_EYE].y * h],
        [lm[RIGHT_EYE].x * w,   lm[RIGHT_EYE].y * h],
        [lm[MOUTH_LEFT].x * w,  lm[MOUTH_LEFT].y * h],
        [lm[MOUTH_RIGHT].x * w, lm[MOUTH_RIGHT].y * h],
    ], dtype=np.float64)

    model_points = np.array([
        [0.0,    0.0,    0.0],
        [0.0,   -330.0, -65.0],
        [-225.0, 170.0, -135.0],
        [225.0,  170.0, -135.0],
        [-150.0, -150.0, -125.0],
        [150.0,  -150.0, -125.0],
    ], dtype=np.float64)

    focal_length = w
    camera_matrix = np.array([
        [focal_length, 0,            w / 2],
        [0,            focal_length, h / 2],
        [0,            0,            1],
    ], dtype=np.float64)

    dist_coeffs = np.zeros((4, 1))
    success, rotation_vec, _ = cv2.solvePnP(
        model_points, image_points, camera_matrix, dist_coeffs,
        flags=cv2.SOLVEPNP_ITERATIVE,
    )
    if not success:
        return None

    rotation_mat, _ = cv2.Rodrigues(rotation_vec)
    pose_mat = cv2.hconcat([rotation_mat, np.zeros((3, 1))])
    _, _, _, _, _, _, euler = cv2.decomposeProjectionMatrix(pose_mat)

    return float(euler[1][0]), float(euler[0][0]), float(euler[2][0])  # yaw, pitch, roll

# ─── Thresholds ───────────────────────────────────────────────────────────────

TURN_THRESHOLD = 12.0
TILT_THRESHOLD = 10.0

def _classify_pose(yaw: float, pitch: float) -> str:
    if yaw > TURN_THRESHOLD:
        return "right"
    if yaw < -TURN_THRESHOLD:
        return "left"
    if pitch > TILT_THRESHOLD:
        return "down"
    if pitch < -TILT_THRESHOLD:
        return "up"
    return "center"

# ─── Public liveness API ──────────────────────────────────────────────────────

REQUIRED_POSES = {"left", "right", "up", "down"}

def liveness_check_multi(image_paths: list[str]) -> Tuple[bool, float, list[str]]:
    """
    Checks that all 4 head poses (left, right, up, down) are present
    across the provided images.
    Returns: (passed, score 0-1, list of detected pose labels)
    """
    detected = set()
    for path in image_paths:
        pose = _get_head_pose(path)
        if pose is None:
            logger.warning(f"[liveness] No face detected in {path}")
            continue
        yaw, pitch, _ = pose
        label = _classify_pose(yaw, pitch)
        logger.info(f"[liveness] {path} → yaw={yaw:.1f} pitch={pitch:.1f} → {label}")
        if label in REQUIRED_POSES:
            detected.add(label)

    missing = REQUIRED_POSES - detected
    passed = len(missing) == 0
    score = round(len(detected) / len(REQUIRED_POSES), 3)
    if missing:
        logger.warning(f"[liveness] Missing poses: {missing}")
    return passed, score, sorted(detected)


def liveness_check(selfie_path: str) -> Tuple[bool, float]:
    """Single-image fallback — checks face is detectable and roughly centered."""
    pose = _get_head_pose(selfie_path)
    if pose is None:
        return False, 0.0
    yaw, pitch, _ = pose
    centered = abs(yaw) < 20 and abs(pitch) < 20
    score = max(0.0, 1.0 - (abs(yaw) + abs(pitch)) / 80.0)
    return centered, round(score, 3)

# ─── Document quality ─────────────────────────────────────────────────────────

def compute_blur_score(image_path: str) -> float:
    img = cv2.imread(image_path)
    if img is None:
        return 0.0
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    return float(cv2.Laplacian(gray, cv2.CV_64F).var())


def compute_brightness(image_path: str) -> float:
    img = cv2.imread(image_path)
    if img is None:
        return 0.0
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    return float(np.mean(gray))


def check_document_quality(image_path: str) -> dict:
    blur = compute_blur_score(image_path)
    brightness = compute_brightness(image_path)
    return {
        "quality_score": round(min(1.0, blur / 300.0), 3),
        "is_blurry": blur < 80.0,
        "blur_value": round(blur, 2),
        "brightness": round(brightness, 2),
    }

# ─── Face matching (stubbed) ──────────────────────────────────────────────────

def load_face_encoding(image_path: str) -> Optional[object]:
    return None


def compare_faces(
    id_image_path: str,
    selfie_image_path: str,
    tolerance: float = None,
) -> dict:
    return {
        "match": True,
        "distance": 0.0,
        "confidence": 1.0,
        "liveness_passed": True,
        "liveness_score": 1.0,
        "error": None,
    }