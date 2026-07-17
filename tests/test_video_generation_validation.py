from __future__ import annotations

import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "server"))

from video_generation_validation import (  # noqa: E402
    VideoGenerationValidationError,
    infer_generation_mode,
    validate_generate_video_request,
)


def _valid(**overrides):
    payload = {
        "provider": "jimeng",
        "model": "seedance-2.0",
        "duration": 5,
        "resolution": "720p",
        "image_url": "",
        "character_refs": [],
        "scene_refs": [],
        "reference_video_url": "",
        "advanced_reference_videos": [],
    }
    payload.update(overrides)
    return validate_generate_video_request(**payload)


class VideoGenerationValidationTests(unittest.TestCase):
    def assert_invalid(self, expected_text: str, **overrides):
        with self.assertRaises(VideoGenerationValidationError) as ctx:
            _valid(**overrides)
        self.assertIn(expected_text, str(ctx.exception))

    def test_infers_generation_mode_from_reference_videos(self):
        self.assertEqual(infer_generation_mode(), "generate")
        self.assertEqual(infer_generation_mode(reference_video_url="/api/files/a.mp4"), "reference_video")
        self.assertEqual(
            infer_generation_mode(reference_video_url="/api/files/a.mp4", advanced_reference_videos=["/api/files/b.mp4"]),
            "advanced_video",
        )

    def test_unknown_model_and_provider_mismatch_are_rejected(self):
        self.assert_invalid("当前不支持的视频模型", model="missing-model")
        self.assert_invalid("不能使用 vidu", provider="vidu", model="seedance-2.0")

    def test_duration_and_resolution_limits_are_rejected(self):
        self.assert_invalid("4-10 秒", model="seedance-2.0-fast", duration=11)
        self.assert_invalid("4-10 秒", model="seedance-2.0-fast", duration=3)
        self.assert_invalid("不支持 1080P 清晰度", model="seedance-2.0-fast", resolution="1080p")

        result = _valid(model="seedance-2.0-fast", duration=4, resolution="720P")
        self.assertEqual(result.mode, "generate")

    def test_ref_image_and_ref_video_support_is_enforced(self):
        result = _valid(model="seedance-1.5-pro", duration=4, character_refs=["/api/files/a.png"])
        self.assertEqual(result.mode, "generate")
        self.assert_invalid("不支持参考视频", model="seedance-1.5-pro", reference_video_url="/api/files/a.mp4")
        self.assert_invalid(
            "不支持参考视频",
            provider="vidu",
            model="viduq3-pro",
            duration=1,
            reference_video_url="/api/files/a.mp4",
        )

    def test_ref_count_limits_are_enforced(self):
        self.assert_invalid(
            "最多支持 3 个参考视频",
            model="seedance-2.0",
            advanced_reference_videos=["1.mp4", "2.mp4", "3.mp4", "4.mp4"],
        )
        self.assert_invalid(
            "最多支持 1 张参考图",
            provider="vidu",
            model="viduq3-turbo",
            duration=1,
            image_url="/api/files/first.png",
            character_refs=["/api/files/extra.png"],
        )
        self.assert_invalid(
            "最多支持 9 张参考图",
            provider="happyhorse",
            model="happyhorse-1.0-r2v",
            duration=3,
            character_refs=[f"/api/files/{idx}.png" for idx in range(10)],
        )
        self.assert_invalid(
            "最多支持 5 张参考图",
            provider="happyhorse",
            model="happyhorse-1.0-video-edit",
            duration=3,
            character_refs=[f"/api/files/{idx}.png" for idx in range(6)],
            reference_video_url="/api/files/a.mp4",
        )
        self.assert_invalid(
            "需要且仅支持 1 个参考视频",
            provider="happyhorse",
            model="happyhorse-1.0-video-edit",
            duration=3,
            reference_video_url="/api/files/a.mp4",
            advanced_reference_videos=["/api/files/b.mp4"],
        )

    def test_happyhorse_required_inputs_are_enforced(self):
        self.assert_invalid(
            "至少 1 张参考图",
            provider="happyhorse",
            model="happyhorse-1.0-i2v",
            duration=3,
        )
        self.assert_invalid(
            "至少 1 张角色/场景参考图",
            provider="happyhorse",
            model="happyhorse-1.0-r2v",
            duration=3,
        )
        self.assert_invalid(
            "需要且仅支持 1 个参考视频",
            provider="happyhorse",
            model="happyhorse-1.0-video-edit",
            duration=3,
        )

        i2v = _valid(provider="happyhorse", model="happyhorse-1.0-i2v", duration=3, image_url="/api/files/first.png")
        r2v = _valid(provider="happyhorse", model="happyhorse-1.0-r2v", duration=3, character_refs=["/api/files/a.png"])
        edit = _valid(
            provider="happyhorse",
            model="happyhorse-1.0-video-edit",
            duration=3,
            reference_video_url="/api/files/a.mp4",
        )
        self.assertEqual((i2v.mode, r2v.mode, edit.mode), ("generate", "generate", "reference_video"))


if __name__ == "__main__":
    unittest.main()
