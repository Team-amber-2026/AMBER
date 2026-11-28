from rest_framework.exceptions import NotAuthenticated
from rest_framework.views import exception_handler


def session_exception_handler(exc, context):
    response = exception_handler(exc, context)
    if isinstance(exc, NotAuthenticated):
        response.data["code"] = exc.get_codes()
    return response
