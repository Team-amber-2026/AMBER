from django.db import migrations


def reconcile_legacy_history_table(apps, schema_editor):
    connection = schema_editor.connection
    history_model = apps.get_model("receipts", "OCRCorrectionHistory")
    expense_model = apps.get_model("expenses", "Expense")
    table = history_model._meta.db_table
    legacy_table = f"{table}_legacy_job_schema"
    quote = connection.ops.quote_name

    with connection.cursor() as cursor:
        tables = set(connection.introspection.table_names(cursor))
        if table not in tables:
            return

        columns = {
            column.name
            for column in connection.introspection.get_table_description(cursor, table)
        }
        if "job_id" not in columns:
            return
        if legacy_table in tables:
            raise RuntimeError(f"Legacy table already exists: {legacy_table}")

        cursor.execute(f"ALTER TABLE {quote(table)} RENAME TO {quote(legacy_table)}")

    schema_editor.create_model(history_model)

    copy_columns = ("id", "expense_id", "ocr_values", "saved_values", "created_at")
    selected_columns = ", ".join(f"legacy.{quote(column)}" for column in copy_columns)
    insert_columns = ", ".join(quote(column) for column in copy_columns)
    with connection.cursor() as cursor:
        cursor.execute(
            f"""
            INSERT INTO {quote(table)} ({insert_columns})
            SELECT {selected_columns}
            FROM {quote(legacy_table)} AS legacy
            WHERE legacy.{quote('expense_id')} IS NOT NULL
              AND legacy.{quote('expense_id')} IN (
                  SELECT {quote('id')} FROM {quote(expense_model._meta.db_table)}
              )
              AND legacy.{quote('expense_id')} NOT IN (
                  SELECT {quote('expense_id')}
                  FROM {quote(legacy_table)}
                  WHERE {quote('expense_id')} IS NOT NULL
                  GROUP BY {quote('expense_id')}
                  HAVING COUNT(*) > 1
              )
            """
        )


class Migration(migrations.Migration):
    dependencies = [
        ("receipts", "0001_initial"),
    ]

    operations = [
        migrations.RunPython(reconcile_legacy_history_table, migrations.RunPython.noop),
    ]