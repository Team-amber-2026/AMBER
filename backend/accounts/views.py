from django.conf import settings
from django.contrib.auth import login, logout
from django.middleware.csrf import get_token
from django.shortcuts import redirect, render
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import ensure_csrf_cookie
from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .serializers import LoginSerializer, RegisterSerializer, UserSerializer


def wants_html(request):
    return "text/html" in request.META.get("HTTP_ACCEPT", "")


@method_decorator(ensure_csrf_cookie, name="dispatch")
class CsrfTokenView(APIView):
    permission_classes = [AllowAny]

    def get(self, request):
        return Response({"csrfToken": get_token(request)})


@method_decorator(ensure_csrf_cookie, name="dispatch")
class CurrentUserView(APIView):
    permission_classes = [AllowAny]

    def get(self, request):
        if wants_html(request):
            return render(
                request,
                "accounts/user.html",
                {"user_data": UserSerializer(request.user).data if request.user.is_authenticated else None},
            )

        if not request.user.is_authenticated:
            return Response(
                {"detail": "認証されていません。"},
                status=status.HTTP_403_FORBIDDEN,
            )

        return Response(UserSerializer(request.user).data)


class RegisterView(APIView):
    permission_classes = [AllowAny]

    def get(self, request):
        return render(request, "accounts/register.html")

    def post(self, request):
        serializer = RegisterSerializer(data=request.data)
        if not serializer.is_valid():
            if wants_html(request):
                return render(
                    request,
                    "accounts/register.html",
                    {"errors": serializer.errors, "values": request.data},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            serializer.is_valid(raise_exception=True)

        user = serializer.save()
        if wants_html(request):
            return redirect("auth-login")

        return Response(UserSerializer(user).data, status=status.HTTP_201_CREATED)


class LoginView(APIView):
    permission_classes = [AllowAny]

    def get(self, request):
        return render(request, "accounts/login.html")

    def post(self, request):
        serializer = LoginSerializer(data=request.data, context={"request": request})
        if not serializer.is_valid():
            if wants_html(request):
                return render(
                    request,
                    "accounts/login.html",
                    {"errors": serializer.errors, "values": request.data},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            serializer.is_valid(raise_exception=True)

        user = serializer.validated_data["user"]
        login(request, user)
        if wants_html(request):
            return redirect("auth-user")

        return Response(UserSerializer(user).data)


class LogoutView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return render(request, "accounts/logout.html")

    def post(self, request):
        logout(request)
        if wants_html(request):
            return redirect("auth-login")

        response = Response(status=status.HTTP_204_NO_CONTENT)
        response.delete_cookie(
            settings.SESSION_COOKIE_NAME,
            path=settings.SESSION_COOKIE_PATH,
            domain=settings.SESSION_COOKIE_DOMAIN,
            samesite=settings.SESSION_COOKIE_SAMESITE,
        )
        return response
