from __future__ import annotations

import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "server"))

import video_model_registry  # noqa: E402


def _catalog_by_id() -> dict[str, dict]:
    return {item["id"]: item for item in video_model_registry.get_all_video_model_specs()}


class VideoModelSpecsTests(unittest.TestCase):
    def test_full_catalog_contains_expected_model_specs(self):
        catalog = _catalog_by_id()

        seedance = catalog["seedance-2.0"]
        self.assertEqual(seedance["provider"], "jimeng")
        self.assertTrue(seedance["supports_ref_video"])
        self.assertTrue(seedance["supports_ref_images"])
        self.assertEqual(seedance["min_duration"], 4)
        self.assertEqual(seedance["max_duration"], 15)
        self.assertEqual(seedance["max_ref_images"], 9)
        self.assertEqual(seedance["max_ref_videos"], 3)
        self.assertEqual(seedance["ref_video_duration_limit"], 15.2)
        self.assertEqual(seedance["supported_resolutions"], ["720p", "1080p"])
        self.assertIn("motion_transfer", seedance["supported_modes"])
        self.assertEqual(seedance["price_per_second"], 1.0)
        self.assertEqual(seedance["price_resolution_multiplier_1080p"], 2.25)

        seedance_fast = catalog["seedance-2.0-fast"]
        self.assertEqual(seedance_fast["max_duration"], 10)
        self.assertEqual(seedance_fast["supported_resolutions"], ["720p"])
        self.assertNotIn("motion_transfer", seedance_fast["supported_modes"])
        self.assertEqual(seedance_fast["price_per_second"], 0.8)

        seedance_15 = catalog["seedance-1.5-pro"]
        self.assertFalse(seedance_15["supports_ref_video"])
        self.assertTrue(seedance_15["supports_ref_images"])
        self.assertEqual(seedance_15["max_ref_images"], 2)
        self.assertEqual(seedance_15["max_duration"], 12)
        self.assertEqual(seedance_15["price_per_second"], 0.3)

        seedance_10_fast = catalog["seedance-1.0-pro-fast"]
        self.assertEqual(seedance_10_fast["name"], "Seedance 1.0 Fast")
        self.assertEqual(seedance_10_fast["min_duration"], 4)
        self.assertEqual(seedance_10_fast["max_duration"], 10)
        self.assertEqual(seedance_10_fast["supported_resolutions"], ["720p"])

        self.assertEqual(catalog["viduq3-pro"]["provider"], "vidu")
        self.assertFalse(catalog["viduq3-pro"]["supports_ref_video"])
        self.assertTrue(catalog["viduq3-pro"]["supports_ref_images"])
        self.assertEqual(catalog["viduq3-pro"]["min_duration"], 1)
        self.assertEqual(catalog["viduq3-pro"]["max_duration"], 16)
        self.assertEqual(catalog["viduq3-pro"]["max_ref_images"], 1)
        self.assertEqual(catalog["viduq3-pro"]["price_per_second"], 0.95)
        self.assertEqual(catalog["viduq3-turbo"]["max_ref_images"], 1)
        self.assertEqual(catalog["viduq3-turbo"]["price_per_second"], 0.45)

        happyhorse_t2v = catalog["happyhorse-1.0-t2v"]
        self.assertFalse(happyhorse_t2v["supports_ref_video"])
        self.assertFalse(happyhorse_t2v["supports_ref_images"])
        self.assertEqual(happyhorse_t2v["min_duration"], 3)
        self.assertEqual(happyhorse_t2v["max_duration"], 15)
        self.assertEqual(happyhorse_t2v["supported_resolutions"], ["720p", "1080p"])
        self.assertEqual(happyhorse_t2v["price_per_second"], 0.9)
        self.assertEqual(happyhorse_t2v["price_per_second_1080p"], 1.6)

        self.assertTrue(catalog["happyhorse-1.0-i2v"]["supports_ref_images"])
        self.assertFalse(catalog["happyhorse-1.0-i2v"]["supports_ref_video"])
        self.assertEqual(catalog["happyhorse-1.0-i2v"]["min_ref_images"], 1)
        self.assertEqual(catalog["happyhorse-1.0-i2v"]["max_ref_images"], 1)

        self.assertTrue(catalog["happyhorse-1.0-r2v"]["supports_ref_images"])
        self.assertFalse(catalog["happyhorse-1.0-r2v"]["supports_ref_video"])
        self.assertEqual(catalog["happyhorse-1.0-r2v"]["min_ref_images"], 1)
        self.assertEqual(catalog["happyhorse-1.0-r2v"]["max_ref_images"], 9)

        happyhorse_edit = catalog["happyhorse-1.0-video-edit"]
        self.assertTrue(happyhorse_edit["supports_ref_video"])
        self.assertTrue(happyhorse_edit["supports_ref_images"])
        self.assertEqual(happyhorse_edit["max_ref_videos"], 1)
        self.assertEqual(happyhorse_edit["max_ref_images"], 5)
        self.assertEqual(happyhorse_edit["ref_video_duration_min"], 3)
        self.assertEqual(happyhorse_edit["ref_video_duration_limit"], 60)
        self.assertEqual(happyhorse_edit["supported_modes"], ["reference_video", "advanced_video"])
        self.assertEqual(happyhorse_edit["price_billing"], "input_output")

    def test_catalog_has_unique_ids_required_fields_and_lookup(self):
        catalog = video_model_registry.get_all_video_model_specs()
        ids = [item.get("id") for item in catalog]
        self.assertEqual(len(ids), len(set(ids)))

        required_fields = {
            "id",
            "name",
            "provider",
            "supports_ref_video",
            "supports_ref_images",
            "min_duration",
            "max_duration",
            "supported_resolutions",
            "default_resolution",
            "supported_modes",
            "price_per_second",
            "price_unit",
        }
        for spec in catalog:
            with self.subTest(model=spec.get("id")):
                self.assertTrue(required_fields.issubset(spec.keys()))
                self.assertGreaterEqual(float(spec["max_duration"]), float(spec["min_duration"]))
                self.assertIn(spec["default_resolution"], spec["supported_resolutions"])
                self.assertGreater(float(spec["price_per_second"]), 0)
                self.assertEqual(spec["price_unit"], "CNY")

        self.assertEqual(video_model_registry.get_video_model_spec("seedance-2.0")["provider"], "jimeng")
        self.assertEqual(video_model_registry.normalize_video_model_id("seedance-1.0-fast"), "seedance-1.0-pro-fast")
        self.assertEqual(video_model_registry.get_video_model_spec("seedance-1.0-fast")["id"], "seedance-1.0-pro-fast")
        self.assertEqual(video_model_registry.get_video_model_spec("missing-model"), {})

    def test_specs_can_be_filtered_by_provider(self):
        self.assertEqual(video_model_registry.get_video_model_specs(provider_filter=[]), [])

        self.assertEqual(
            video_model_registry.get_video_model_specs(),
            video_model_registry.get_all_video_model_specs(),
        )

        models = video_model_registry.get_video_model_specs(provider_filter=["jimeng"])
        self.assertTrue(models)
        self.assertEqual({item["provider"] for item in models}, {"jimeng"})

        models = video_model_registry.get_video_model_specs(provider_filter=["vidu"])
        self.assertEqual({item["provider"] for item in models}, {"vidu"})

        models = video_model_registry.get_video_model_specs(provider_filter=["happyhorse"])
        self.assertEqual({item["provider"] for item in models}, {"happyhorse"})


if __name__ == "__main__":
    unittest.main()
