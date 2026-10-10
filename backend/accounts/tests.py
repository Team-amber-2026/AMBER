import os
from importlib import reload
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.test import SimpleTestCase, override_settings
from django.urls import reverse
from rest_framework.test import APIClient, APITestCase


User = get_user_model()


class SettingsTests(SimpleTestCase):
    def test_cookie_policy_preserves_local_http_and_secure_production_defaults(self):
        import config.settings as settings_module

        scenarios = [
            ({"DEBUG": "True"}, False, "Lax"),
            ({"DEBUG": "True", "SESSION_COOKIE_SECURE": "True",
              "CSRF_COOKIE_SECURE": "True", "SESSION_COOKIE_SAMESITE": "None",
              "CSRF_COOKIE_SAMESITE": "None"}, False, "Lax"),
            ({"DEBUG": "False"}, True, "Lax"),
            ({"DEBUG": "False", "SESSION_COOKIE_SECURE": "False",
              "CSRF_COOKIE_SECURE": "False", "SESSION_COOKIE_SAMESITE": "Strict",
              "CSRF_COOKIE_SAMESITE": "Strict"}, False, "Strict"),
        ]
        try:
            for environment, secure, samesite in scenarios:
                with self.subTest(environment=environment), patch.dict(os.environ, environment, clear=True):
                    configured = reload(settings_module)
                    self.assertEqual(configured.SESSION_COOKIE_SECURE, secure)
                    self.assertEqual(configured.CSRF_COOKIE_SECURE, secure)
                    self.assertEqual(configured.SESSION_COOKIE_SAMESITE, samesite)
                    self.assertEqual(configured.CSRF_COOKIE_SAMESITE, samesite)
        finally:
            reload(settings_module)

    def test_vercel_frontend_defaults_are_scoped_to_the_configured_project(self):
        with patch.dict(
            os.environ,
            {
                "FRONTEND_ORIGIN": "https://amber-lilac.vercel.app",
                "FRONTEND_PREVIEW_ORIGINS": "https://amber-lilac-git-feature-vercel-repair-hyosetsus-projects.vercel.app",
            },
            clear=False,
        ):
            import config.settings as settings_module

            reloaded_settings = reload(settings_module)

            self.assertIn("https://amber-lilac.vercel.app", reloaded_settings.CORS_ALLOWED_ORIGINS)
            self.assertIn("https://amber-lilac.vercel.app", reloaded_settings.CORS_ALLOWED_ORIGINS)
            self.assertIn(
                "https://amber-lilac-git-feature-vercel-repair-hyosetsus-projects.vercel.app",
                reloaded_settings.CORS_ALLOWED_ORIGINS,
            )
            self.assertIn("https://amber-lilac.vercel.app", reloaded_settings.CSRF_TRUSTED_ORIGINS)
            self.assertIn(
                "https://amber-lilac-git-feature-vercel-repair-hyosetsus-projects.vercel.app",
                reloaded_settings.CSRF_TRUSTED_ORIGINS,
            )
            self.assertNotIn("https://*.vercel.app", reloaded_settings.CSRF_TRUSTED_ORIGINS)
            self.assertNotIn("https://amber-lilac-attacker.vercel.app", reloaded_settings.CORS_ALLOWED_ORIGINS)
            self.assertNotIn("https://attacker.vercel.app", reloaded_settings.CORS_ALLOWED_ORIGINS)


@override_settings(ROOT_URLCONF="config.urls")
class AuthApiTests(APITestCase):
    def setUp(self):
        self.client = APIClient(enforce_csrf_checks=True)

    def _csrf_token(self):
        response = self.client.get(reverse("auth-csrf"))
        self.assertEqual(response.status_code, 200)
        self.assertIn("csrfToken", response.data)
        return response.data["csrfToken"]

    def test_csrf_endpoint_returns_token_and_sets_cookie(self):
        response = self.client.get(reverse("auth-csrf"))

        self.assertEqual(response.status_code, 200)
        self.assertIn("csrfToken", response.data)
        self.assertIn("csrftoken", response.cookies)
        self.assertFalse(response.cookies["csrftoken"]["secure"])
        self.assertEqual(response.cookies["csrftoken"]["samesite"], "Lax")

    def test_user_endpoint_sets_csrf_cookie_when_anonymous(self):
        response = self.client.get(reverse("auth-user"))

        self.assertEqual(response.status_code, 403)
        self.assertIn("csrftoken", response.cookies)

    def test_register_requires_csrf_and_hashes_password(self):
        response = self.client.post(
            reverse("auth-register"),
            {"username": "alice", "email": "alice@example.com", "password": "StrongPass123"},
            format="json",
        )
        self.assertEqual(response.status_code, 403)

        token = self._csrf_token()
        response = self.client.post(
            reverse("auth-register"),
            {"username": "alice", "email": "alice@example.com", "password": "StrongPass123"},
            HTTP_X_CSRFTOKEN=token,
            HTTP_ORIGIN="http://localhost:3000",
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        self.assertNotIn("password", response.data)
        user = User.objects.get(username="alice")
        self.assertTrue(user.check_password("StrongPass123"))

    def test_register_rejects_duplicate_username_and_email(self):
        User.objects.create_user(
            username="alice",
            email="alice@example.com",
            password="StrongPass123",
        )
        token = self._csrf_token()

        response = self.client.post(
            reverse("auth-register"),
            {"username": "alice", "email": "ALICE@example.com", "password": "StrongPass123"},
            HTTP_X_CSRFTOKEN=token,
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("username", response.data)
        self.assertIn("email", response.data)

    def test_register_rejects_passwords_described_in_the_guidance(self):
        token = self._csrf_token()
        scenarios = [
            ("aB!xZ?7", "password_too_short"),
            ("password", "password_too_common"),
            ("918273645091", "password_entirely_numeric"),
        ]
        for password, expected_code in scenarios:
            with self.subTest(expected_code=expected_code):
                response = self.client.post(
                    reverse("auth-register"),
                    {"username": "password-test", "email": "test@example.com", "password": password},
                    HTTP_X_CSRFTOKEN=token,
                    format="json",
                )
                self.assertEqual(response.status_code, 400)
                with self.assertRaises(ValidationError) as validation:
                    validate_password(password)
                self.assertIn(expected_code, [error.code for error in validation.exception.error_list])
                self.assertEqual(response.data["password"], validation.exception.messages)
                self.assertFalse(User.objects.filter(username="password-test").exists())

    def test_register_accepts_eight_characters_without_new_character_type_rules(self):
        token = self._csrf_token()
        # No letters/digits combination or ASCII-only restriction is enforced.
        for index, password in enumerate(("aB!xZ?qR", "QzxvJkmt", "風鈴と星空の散歩道", "!@#$^&*?")):
            with self.subTest(password=password):
                response = self.client.post(
                    reverse("auth-register"),
                    {"username": f"valid-{index}", "email": f"valid-{index}@example.com", "password": password},
                    HTTP_X_CSRFTOKEN=token,
                    format="json",
                )
                self.assertEqual(response.status_code, 201)
                self.assertTrue(User.objects.get(username=f"valid-{index}").check_password(password))
                self.assertNotIn("password", response.data)

    def test_html_registration_shows_guidance_and_errors_only_above_the_form(self):
        response = self.client.get(reverse("auth-register"), HTTP_ACCEPT="text/html")
        self.assertContains(response, "8文字以上で入力してください。")
        self.assertContains(response, "よく使われるパスワードは使用できません。")
        self.assertContains(response, "数字だけのパスワードは使用できません。")
        self.assertContains(response, 'aria-describedby="password-help"')
        token = response.cookies["csrftoken"].value
        response = self.client.post(
            reverse("auth-register"),
            {"username": "html-user", "email": "html@example.com", "password": "1234567"},
            HTTP_ACCEPT="text/html",
            HTTP_X_CSRFTOKEN=token,
        )
        self.assertContains(response, 'aria-describedby="password-help register-errors"', status_code=400)
        self.assertContains(response, 'aria-invalid="true"', status_code=400)
        self.assertContains(response, 'id="register-errors" class="error" role="alert"', status_code=400)
        self.assertNotContains(response, 'id="password-error"', status_code=400)
        html = response.content.decode()
        for message in response.context["errors"]["password"]:
            self.assertEqual(html.count(str(message)), 1)
            self.assertLess(html.index(str(message)), html.index("<form"))
        self.assertFalse(User.objects.filter(username="html-user").exists())

    def test_login_user_and_logout_flow(self):
        User.objects.create_user(
            username="alice",
            email="alice@example.com",
            password="StrongPass123",
        )
        token = self._csrf_token()

        login_response = self.client.post(
            reverse("auth-login"),
            {"username": "alice", "password": "StrongPass123"},
            HTTP_X_CSRFTOKEN=token,
            HTTP_ORIGIN="http://localhost:3000",
            format="json",
        )
        self.assertEqual(login_response.status_code, 200)
        self.assertIn("sessionid", login_response.cookies)
        self.assertFalse(login_response.cookies["sessionid"]["secure"])
        self.assertEqual(login_response.cookies["sessionid"]["samesite"], "Lax")

        user_response = self.client.get(reverse("auth-user"))
        self.assertEqual(user_response.status_code, 200)
        self.assertEqual(user_response.data["username"], "alice")

        logout_response = self.client.post(
            reverse("auth-logout"),
            HTTP_X_CSRFTOKEN=self.client.cookies["csrftoken"].value,
        )
        self.assertEqual(logout_response.status_code, 204)

        user_response = self.client.get(reverse("auth-user"))
        self.assertEqual(user_response.status_code, 403)

    def test_login_accepts_email_address(self):
        User.objects.create_user(
            username="alice",
            email="alice@example.com",
            password="StrongPass123",
        )
        token = self._csrf_token()

        response = self.client.post(
            reverse("auth-login"),
            {"username": "ALICE@example.com", "password": "StrongPass123"},
            HTTP_X_CSRFTOKEN=token,
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["username"], "alice")

    def test_auth_pages_are_available_in_browser(self):
        for url_name in ("auth-user", "auth-register", "auth-login"):
            response = self.client.get(reverse(url_name), HTTP_ACCEPT="text/html")
            self.assertEqual(response.status_code, 200)
            self.assertIn("text/html", response["Content-Type"])

    def test_register_and_login_work_from_html_forms(self):
        response = self.client.get(reverse("auth-register"), HTTP_ACCEPT="text/html")
        token = response.cookies["csrftoken"].value

        response = self.client.post(
            reverse("auth-register"),
            {"username": "alice", "email": "alice@example.com", "password": "StrongPass123"},
            HTTP_ACCEPT="text/html",
            HTTP_X_CSRFTOKEN=token,
        )
        self.assertEqual(response.status_code, 302)
        self.assertEqual(response["Location"], reverse("auth-login"))

        response = self.client.post(
            reverse("auth-login"),
            {"username": "alice", "password": "StrongPass123"},
            HTTP_ACCEPT="text/html",
            HTTP_X_CSRFTOKEN=self.client.cookies["csrftoken"].value,
        )
        self.assertEqual(response.status_code, 302)
        self.assertEqual(response["Location"], reverse("auth-user"))

        response = self.client.get(reverse("auth-logout"), HTTP_ACCEPT="text/html")
        self.assertEqual(response.status_code, 200)
        self.assertIn("text/html", response["Content-Type"])


@override_settings(
    ALLOWED_HOSTS=["amber-api-usdz.onrender.com"],
    CSRF_TRUSTED_ORIGINS=["https://amber.example.com"],
    SESSION_COOKIE_SECURE=True,
    CSRF_COOKIE_SECURE=True,
    SESSION_COOKIE_SAMESITE="Lax",
    CSRF_COOKIE_SAMESITE="Lax",
)
class ProxiedAuthApiTests(APITestCase):
    """Exercise Django with the backend Host and the browser's frontend Origin."""

    def setUp(self):
        self.client = APIClient(enforce_csrf_checks=True)
        self.client.defaults.update(
            HTTP_HOST="amber-api-usdz.onrender.com",
            HTTP_ORIGIN="https://amber.example.com",
            HTTP_X_FORWARDED_PROTO="https",
        )
        self.credentials = {
            "username": "proxy-user",
            "email": "proxy@example.com",
            "password": "StrongPass123",
        }

    def assert_first_party_cookie(self, cookie):
        self.assertEqual(cookie["domain"], "")
        self.assertEqual(cookie["path"], "/")
        self.assertEqual(cookie["samesite"], "Lax")
        self.assertTrue(cookie["secure"])

    def test_registration_login_reload_expenses_and_logout_through_proxy(self):
        csrf_response = self.client.get(reverse("auth-csrf"))
        self.assertEqual(csrf_response.status_code, 200)
        self.assertTrue(csrf_response.wsgi_request.is_secure())
        self.assert_first_party_cookie(csrf_response.cookies["csrftoken"])
        token = csrf_response.data["csrfToken"]

        register_response = self.client.post(
            reverse("auth-register"), self.credentials,
            format="json", HTTP_X_CSRFTOKEN=token,
        )
        self.assertEqual(register_response.status_code, 201)
        # Registration retains the existing contract: the user logs in next.
        login_response = self.client.post(
            reverse("auth-login"), self.credentials,
            format="json", HTTP_X_CSRFTOKEN=token,
        )
        self.assertEqual(login_response.status_code, 200)
        self.assert_first_party_cookie(login_response.cookies["sessionid"])
        self.assertTrue(login_response.cookies["sessionid"]["httponly"])
        self.assert_first_party_cookie(login_response.cookies["csrftoken"])

        reloaded_client = APIClient(enforce_csrf_checks=True)
        reloaded_client.defaults.update(self.client.defaults)
        reloaded_client.cookies = self.client.cookies.copy()
        user_response = reloaded_client.get(reverse("auth-user"))
        self.assertEqual(user_response.status_code, 200)
        self.assertEqual(user_response.data["username"], self.credentials["username"])
        self.assertEqual(reloaded_client.get("/api/expenses/").status_code, 200)

        # Django rotates the CSRF secret at login. The old token must fail.
        stale_logout = reloaded_client.post(reverse("auth-logout"), HTTP_X_CSRFTOKEN=token)
        self.assertEqual(stale_logout.status_code, 403)
        logout_response = reloaded_client.post(
            reverse("auth-logout"),
            HTTP_X_CSRFTOKEN=reloaded_client.cookies["csrftoken"].value,
        )
        self.assertEqual(logout_response.status_code, 204)
        self.assertEqual(logout_response.cookies["sessionid"]["max-age"], 0)
        self.assertEqual(reloaded_client.get(reverse("auth-user")).status_code, 403)
        self.assertEqual(reloaded_client.get("/api/expenses/").status_code, 403)

    def test_proxy_does_not_bypass_csrf_cookie_or_header_checks(self):
        response = self.client.post(reverse("auth-register"), self.credentials, format="json")
        self.assertEqual(response.status_code, 403)
        token = self.client.get(reverse("auth-csrf")).data["csrfToken"]
        response = self.client.post(reverse("auth-register"), self.credentials, format="json")
        self.assertEqual(response.status_code, 403)
        self.client.cookies.clear()
        response = self.client.post(
            reverse("auth-register"), self.credentials,
            format="json", HTTP_X_CSRFTOKEN=token,
        )
        self.assertEqual(response.status_code, 403)
        self.assertFalse(User.objects.filter(username=self.credentials["username"]).exists())

    def test_proxy_rejects_untrusted_origin_even_with_valid_csrf_token(self):
        token = self.client.get(reverse("auth-csrf")).data["csrfToken"]
        response = self.client.post(
            reverse("auth-register"), self.credentials,
            format="json", HTTP_X_CSRFTOKEN=token,
            HTTP_ORIGIN="https://untrusted.example.com",
        )
        self.assertEqual(response.status_code, 403)
        self.assertFalse(User.objects.filter(username=self.credentials["username"]).exists())
