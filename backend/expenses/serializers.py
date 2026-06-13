from rest_framework import serializers

from .models import Expense


class ExpenseSerializer(serializers.ModelSerializer):
    user = serializers.PrimaryKeyRelatedField(read_only=True)

    class Meta:
        model = Expense
        fields = [
            "id",
            "user",
            "shop_name",
            "total_amount",
            "purchased_at",
            "category",
            "image",
            "raw_ocr_text",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "user", "created_at", "updated_at"]

    def validate_category(self, value):
        if not value.strip():
            raise serializers.ValidationError("カテゴリーを選択してください。")
        return value.strip()
