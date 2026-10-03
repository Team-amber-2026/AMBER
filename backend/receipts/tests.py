from importlib import import_module

from django.apps import apps
from django.contrib.auth import get_user_model
from django.db import connection
from django.test import TransactionTestCase

from expenses.models import Expense


legacy_history_migration = import_module(
    "receipts.migrations.0002_reconcile_legacy_ocr_history"
)
history_archive_migration = import_module(
    "receipts.migrations.0003_reconcile_history_archive_constraints"
)
reconcile_legacy_history_table = legacy_history_migration.reconcile_legacy_history_table
detach_legacy_history_archive = history_archive_migration.detach_legacy_history_archive

User = get_user_model()


class LegacyHistoryArchiveMigrationTests(TransactionTestCase):
    def test_copying_legacy_ids_resets_sequence_and_detaches_archive(self):
        user = User.objects.create_user(username="copy-test", password="test-password")
        migrated_expense = Expense.objects.create(
            user=user,
            shop_name="Migrated receipt",
            purchased_at="2026-10-03",
            total_amount=100,
            category="その他",
        )
        new_expense = Expense.objects.create(
            user=user,
            shop_name="New receipt",
            purchased_at="2026-10-03",
            total_amount=200,
            category="その他",
        )
        history_model = apps.get_model("receipts", "OCRCorrectionHistory")
        archive_table = "receipts_ocrcorrectionhistory_legacy_job_schema"

        try:
            with connection.schema_editor() as schema_editor:
                schema_editor.delete_model(history_model)

            with connection.cursor() as cursor:
                cursor.execute("CREATE TABLE receipts_ocrjob (id char(32) PRIMARY KEY)")
                cursor.execute(
                    """
                    CREATE TABLE receipts_ocrcorrectionhistory (
                        id bigint NOT NULL PRIMARY KEY,
                        ocr_values text NOT NULL,
                        saved_values text NOT NULL,
                        created_at timestamp NOT NULL,
                        expense_id bigint REFERENCES expenses_expense(id),
                        job_id char(32) NOT NULL REFERENCES receipts_ocrjob(id)
                    )
                    """
                )
                cursor.execute("INSERT INTO receipts_ocrjob (id) VALUES ('legacy-job')")
                cursor.execute(
                    """
                    INSERT INTO receipts_ocrcorrectionhistory
                        (id, ocr_values, saved_values, created_at, expense_id, job_id)
                    VALUES (41, '{}', '{}', CURRENT_TIMESTAMP, %s, 'legacy-job')
                    """,
                    [migrated_expense.id],
                )

            with connection.schema_editor() as schema_editor:
                reconcile_legacy_history_table(apps, schema_editor)

            self.assertTrue(history_model.objects.filter(pk=41).exists())
            new_history = history_model.objects.create(
                expense=new_expense,
                ocr_values={},
                saved_values={},
            )
            self.assertGreater(new_history.pk, 41)

            with connection.cursor() as cursor:
                constraints = connection.introspection.get_constraints(cursor, archive_table)
                self.assertFalse(any(item.get("foreign_key") for item in constraints.values()))

            migrated_expense.delete()
            with connection.cursor() as cursor:
                cursor.execute(f"SELECT COUNT(*) FROM {connection.ops.quote_name(archive_table)}")
                self.assertEqual(cursor.fetchone()[0], 1)
        finally:
            with connection.cursor() as cursor:
                tables = set(connection.introspection.table_names(cursor))
                for table in (archive_table, "receipts_ocrcorrectionhistory", "receipts_ocrjob"):
                    if table in tables and table != "receipts_ocrcorrectionhistory":
                        cursor.execute(f"DROP TABLE {connection.ops.quote_name(table)}")

    def test_detaching_archive_constraints_allows_expense_deletion(self):
        user = User.objects.create_user(username="archive-test", password="test-password")
        expense = Expense.objects.create(
            user=user,
            shop_name="Archive test",
            purchased_at="2026-10-03",
            total_amount=100,
            category="その他",
        )

        with connection.cursor() as cursor:
            cursor.execute("CREATE TABLE receipts_ocrjob (id char(32) PRIMARY KEY)")
            cursor.execute(
                """
                CREATE TABLE receipts_ocrcorrectionhistory_legacy_job_schema (
                    id integer PRIMARY KEY,
                    expense_id bigint REFERENCES expenses_expense(id),
                    job_id char(32) NOT NULL REFERENCES receipts_ocrjob(id),
                    ocr_values text NOT NULL,
                    saved_values text NOT NULL,
                    created_at datetime NOT NULL
                )
                """
            )
            cursor.execute("INSERT INTO receipts_ocrjob (id) VALUES ('legacy-job')")
            cursor.execute(
                """
                INSERT INTO receipts_ocrcorrectionhistory_legacy_job_schema
                    (id, expense_id, job_id, ocr_values, saved_values, created_at)
                VALUES (1, %s, 'legacy-job', '{}', '{}', CURRENT_TIMESTAMP)
                """,
                [expense.id],
            )

        with connection.schema_editor() as schema_editor:
            detach_legacy_history_archive(schema_editor)

        with connection.cursor() as cursor:
            constraints = connection.introspection.get_constraints(
                cursor,
                "receipts_ocrcorrectionhistory_legacy_job_schema",
            )
            self.assertFalse(any(item.get("foreign_key") for item in constraints.values()))

        expense.delete()
        with connection.cursor() as cursor:
            cursor.execute("SELECT COUNT(*) FROM receipts_ocrcorrectionhistory_legacy_job_schema")
            self.assertEqual(cursor.fetchone()[0], 1)