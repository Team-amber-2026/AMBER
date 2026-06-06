from rest_framework import status
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView


MAX_IMAGE_SIZE = 10 * 1024 * 1024


class ReceiptAnalyzeView(APIView):
    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser]

    def post(self, request):
        image = request.FILES.get("image")
        if image is None:
            return Response(
                {"detail": "レシート画像を選択してください。"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not image.content_type.startswith("image/"):
            return Response(
                {"detail": "画像ファイルを選択してください。"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if image.size > MAX_IMAGE_SIZE:
            return Response(
                {"detail": "画像サイズは10MB以下にしてください。"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        return Response(
            {
                "shop_name": None,
                "purchased_at": None,
                "total_amount": None,
                "raw_ocr_text": "",
                "image": {
                    "name": image.name,
                    "size": image.size,
                    "content_type": image.content_type,
                },
                "detail": "画像を受け付けました。OCR解析は次の実装で接続します。",
            },
            status=status.HTTP_200_OK,
        )
