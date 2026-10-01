"""
Standardized Backend Error Handler Tests

Verifies that 404, 405, and 500 error handlers return consistent,
standardized JSON responses with code and user-friendly error messages
rather than raw stack traces or default HTML pages.
"""

import unittest
from app import app, _handle_500


class TestStandardizedErrorHandlers(unittest.TestCase):
    def setUp(self):
        self.app = app
        self.client = self.app.test_client()

    def test_404_handler_returns_standardized_json(self):
        """404 errors should return standardized JSON with code='not_found'."""
        response = self.client.get("/definitely-nonexistent-route-for-testing-404")
        self.assertEqual(response.status_code, 404)
        data = response.get_json()
        self.assertIsNotNone(data)
        self.assertFalse(data.get("success"))
        self.assertEqual(data.get("code"), "not_found")
        self.assertEqual(data.get("error"), "The requested resource was not found.")

    def test_405_handler_returns_standardized_json(self):
        """405 method not allowed should return standardized JSON with code='method_not_allowed'."""
        response = self.client.post("/health")
        self.assertEqual(response.status_code, 405)
        data = response.get_json()
        self.assertIsNotNone(data)
        self.assertFalse(data.get("success"))
        self.assertEqual(data.get("code"), "method_not_allowed")
        self.assertEqual(data.get("error"), "Method not allowed for this route.")

    def test_500_handler_returns_standardized_json(self):
        """500 handler should return standardized JSON with code='internal_server_error'."""
        with self.app.test_request_context():
            response, status = _handle_500(RuntimeError("Simulated server failure"))
            self.assertEqual(status, 500)
            data = response.get_json()
            self.assertIsNotNone(data)
            self.assertFalse(data.get("success"))
            self.assertEqual(data.get("code"), "internal_server_error")
            self.assertEqual(data.get("error"), "An unexpected server error occurred. Please try again.")


if __name__ == "__main__":
    unittest.main()
