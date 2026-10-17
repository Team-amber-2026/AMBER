from django.conf import settings
from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.test import TransactionTestCase


class CategoryMigrationTests(TransactionTestCase):
    migrate_from = [("expenses", "0003_expense_image_format")]
    migrate_to = [("expenses", "0004_category_expense_category_fk")]

    def migrate(self, targets):
        executor = MigrationExecutor(connection)
        executor.migrate(targets)
        return executor.loader.project_state(targets).apps

    def test_forward_and_reverse_preserve_category_names(self):
        latest = MigrationExecutor(connection).loader.graph.leaf_nodes()
        self.addCleanup(self.migrate, latest)
        old_apps = self.migrate(self.migrate_from)
        User = old_apps.get_model(settings.AUTH_USER_MODEL)
        Expense = old_apps.get_model("expenses", "Expense")
        user = User.objects.create(username="migration-user")
        names = ["食費", "日用品", "交通費", "その他", "医療費"]
        ids = [
            Expense.objects.create(
                user_id=user.pk, category=name,
                purchased_at="2026-08-01", total_amount=100,
            ).pk
            for name in names
        ]

        apps = self.migrate(self.migrate_to)
        Expense = apps.get_model("expenses", "Expense")
        Category = apps.get_model("expenses", "Category")
        expected = dict(zip(ids, [*names[:4], "その他"]))
        self.assertEqual(
            dict(Expense.objects.values_list("pk", "category__name")), expected,
        )
        # Rollback must also preserve edits and records created after migration.
        Expense.objects.filter(pk=ids[0]).update(category=Category.objects.get(name="交通費"))
        expected[ids[0]] = "交通費"
        custom = Category.objects.create(name="書籍")
        new_expense = Expense.objects.create(
            user_id=user.pk, category=custom,
            purchased_at="2026-08-02", total_amount=200,
        )
        expected[new_expense.pk] = "書籍"

        apps = self.migrate(self.migrate_from)
        Expense = apps.get_model("expenses", "Expense")
        self.assertEqual(dict(Expense.objects.values_list("pk", "category")), expected)
