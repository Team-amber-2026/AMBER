from django.db import transaction
from django.db.models import Sum
from django.utils import timezone
from rest_framework import status
from rest_framework.exceptions import NotFound
from rest_framework.parsers import JSONParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Expense
from .serializers import ExpenseSerializer
from receipts.models import OCRCorrectionHistory


class ExpenseListCreateView(APIView):
    permission_classes = [IsAuthenticated]
    parser_classes = [JSONParser]

    def get(self, request):
        expenses = Expense.objects.filter(user=request.user)
        serializer = ExpenseSerializer(expenses, many=True)
        return Response(serializer.data)

    def post(self, request):
        serializer = ExpenseSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        ocr_result = serializer.validated_data.get("ocr_result")
        with transaction.atomic():
            expense = serializer.save(user=request.user)
            if ocr_result:
                OCRCorrectionHistory.objects.create(
                    expense=expense,
                    ocr_values={
                        **ocr_result,
                        "purchased_at": (
                            ocr_result["purchased_at"].isoformat()
                            if ocr_result["purchased_at"]
                            else None
                        ),
                    },
                    saved_values={
                        "shop_name": expense.shop_name,
                        "purchased_at": expense.purchased_at.isoformat(),
                        "total_amount": expense.total_amount,
                        "category": expense.category,
                        "raw_ocr_text": expense.raw_ocr_text,
                    },
                )
        return Response(ExpenseSerializer(expense).data, status=status.HTTP_201_CREATED)


class ExpenseDetailView(APIView):
    permission_classes = [IsAuthenticated]
    parser_classes = [JSONParser]

    def get(self, request, pk):
        expense = self._get_expense(request, pk)

        serializer = ExpenseSerializer(expense)
        return Response(serializer.data)

    def put(self, request, pk):
        return self._update(request, pk, partial=False)

    def patch(self, request, pk):
        return self._update(request, pk, partial=True)

    def delete(self, request, pk):
        expense = self._get_expense(request, pk)
        expense.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    def _update(self, request, pk, partial):
        expense = self._get_expense(request, pk)
        serializer = ExpenseSerializer(expense, data=request.data, partial=partial)
        serializer.is_valid(raise_exception=True)
        expense = serializer.save()
        return Response(ExpenseSerializer(expense).data)

    @staticmethod
    def _get_expense(request, pk):
        expense = Expense.objects.filter(user=request.user, pk=pk).first()
        if expense is None:
            raise NotFound()
        return expense


class MonthlyExpenseSummaryView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        year, month, error = self._get_year_month(request)
        if error:
            return Response(error, status=status.HTTP_400_BAD_REQUEST)

        expenses = Expense.objects.filter(
            user=request.user,
            purchased_at__year=year,
            purchased_at__month=month,
        )

        grand_total = expenses.aggregate(total=Sum("total_amount"))["total"] or 0
        categories = (
            expenses.values("category")
            .annotate(total=Sum("total_amount"))
            .order_by("category")
        )

        return Response(
            {
                "year": year,
                "month": month,
                "grand_total": grand_total,
                "categories": [
                    {"category": item["category"], "total": item["total"] or 0}
                    for item in categories
                ],
            }
        )

    def _get_year_month(self, request):
        today = timezone.localdate()
        year_value = request.query_params.get("year", today.year)
        month_value = request.query_params.get("month", today.month)

        try:
            year = int(year_value)
            month = int(month_value)
        except (TypeError, ValueError):
            return None, None, {"detail": "year and month must be integers."}

        if year < 1:
            return None, None, {"detail": "year must be greater than or equal to 1."}
        if month < 1 or month > 12:
            return None, None, {"detail": "month must be between 1 and 12."}

        return year, month, None
