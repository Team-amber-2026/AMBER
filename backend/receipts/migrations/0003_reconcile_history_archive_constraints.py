from django.core.management.color import no_style
from django.db import migrations


def detach_legacy_history_archive(schema_editor):
    connection = schema_editor.connection
    quote = connection.ops.quote_name
    table = "receipts_ocrcorrectionhistory_legacy_job_schema"
    detached_table = f"{table}_detached"

    with connection.cursor() as cursor:
        tables = set(connection.introspection.table_names(cursor))
        if table in tables:
            if detached_table in tables:
                raise RuntimeError(f"Detached table already exists: {detached_table}")

            cursor.execute(
                f"CREATE TABLE {quote(detached_table)} AS SELECT * FROM {quote(table)}"
            )
            cursor.execute(f"DROP TABLE {quote(table)}")
            cursor.execute(
                f"ALTER TABLE {quote(detached_table)} RENAME TO {quote(table)}"
            )


def reconcile_history_archive_and_sequence(apps, schema_editor):
    detach_legacy_history_archive(schema_editor)

    history_model = apps.get_model("receipts", "OCRCorrectionHistory")
    connection = schema_editor.connection
    for statement in connection.ops.sequence_reset_sql(no_style(), [history_model]):
        schema_editor.execute(statement)


class Migration(migrations.Migration):
    dependencies = [
        ("receipts", "0002_reconcile_legacy_ocr_history"),
    ]

    operations = [
        migrations.RunPython(
            reconcile_history_archive_and_sequence,
            migrations.RunPython.noop,
        ),
    ]