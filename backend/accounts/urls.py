from django.urls import path

from .views import CurrentUserView, LoginView, LogoutView, RegisterView


urlpatterns = [
    path("user/", CurrentUserView.as_view(), name="auth-user"),
    path("register/", RegisterView.as_view(), name="auth-register"),
    path("login/", LoginView.as_view(), name="auth-login"),
    path("logout/", LogoutView.as_view(), name="auth-logout"),
]
