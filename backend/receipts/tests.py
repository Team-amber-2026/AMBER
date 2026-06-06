from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.urls import reverse
from rest_framework.test import APITestCase


User = get_user_model()


class ReceiptAnalyzeApiTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username="alice",
            email="alice@example.com",
            password="StrongPass123",
        )

    def test_analyze_requires_login(self):
        response = self.client.post(reverse("receipt-analyze"))

        self.assertEqual(response.status_code, 403)

    def test_analyze_accepts_image_upload_without_saving_expense(self):
        self.client.force_authenticate(self.user)
        image = SimpleUploadedFile(
            "receipt.jpg",
            b"fake image bytes",
            content_type="image/jpeg",
        )

        response = self.client.post(reverse("receipt-analyze"), {"image": image}, format="multipart")

        self.assertEqual(response.status_code, 200)
        self.assertIsNone(response.data["shop_name"])
        self.assertIsNone(response.data["purchased_at"])
        self.assertIsNone(response.data["total_amount"])
        self.assertEqual(response.data["image"]["name"], "receipt.jpg")
        self.assertEqual(response.data["image"]["content_type"], "image/jpeg")

    def test_analyze_rejects_missing_image(self):
        self.client.force_authenticate(self.user)

        response = self.client.post(reverse("receipt-analyze"), {}, format="multipart")

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["detail"], "レシート画像を選択してください。")

    def test_analyze_rejects_non_image_upload(self):
        self.client.force_authenticate(self.user)
        text_file = SimpleUploadedFile(
            "receipt.txt",
            b"not an image",
            content_type="text/plain",
        )

        response = self.client.post(reverse("receipt-analyze"), {"image": text_file}, format="multipart")

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["detail"], "画像ファイルを選択してください。")
