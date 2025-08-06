import psycopg2
import json
import os
import sys
from urllib.parse import urlparse

# Get database URL from environment variable
DATABASE_URL = os.getenv('NEON_DB_URL', 'postgresql://neondb_owner:npg_PVs3ewizcxA5@ep-shiny-math-a8lmusqf-pooler.eastus2.azure.neon.tech/before_verify2')

# Parse the DATABASE_URL
db_url = urlparse(DATABASE_URL)
username = db_url.username
password = db_url.password
database = db_url.path[1:]
hostname = db_url.hostname
port = db_url.port

# Create connection with SSL required for Neon
conn = psycopg2.connect(
    host=hostname,
    port=port,
    dbname=database,
    user=username,
    password=password,
    sslmode='require'
)

def ensure_columns(cur, table, required_columns):
    # Get existing columns
    cur.execute("SELECT column_name FROM information_schema.columns WHERE table_name=%s;", (table,))
    existing = set(row[0] for row in cur.fetchall())
    for col in required_columns:
        if col not in existing:
            cur.execute('ALTER TABLE {} ADD COLUMN "{}" TEXT;'.format(table, col))

# Track if the table has been dropped in this process
_table_dropped = False

def insert_dynamic(json_data_list, table='documents'):
    global _table_dropped
    cur = conn.cursor()
    # Drop the table only once per program execution
    if not _table_dropped:
        try:
            print("Dropping table if exists...")
            cur.execute("DROP TABLE IF EXISTS {};".format(table))
            print("Table dropped (or did not exist).")
        except Exception as e:
            sys.stderr.write("Error dropping table: {}\n".format(e))
            raise
        _table_dropped = True
    # Create table with all columns from all dicts
    all_keys = set()
    for d in json_data_list:
        all_keys.update(d.keys())
    columns = ', '.join(['"{}" TEXT'.format(k) for k in all_keys])
    try:
        print("Creating table if not exists...")
        cur.execute('CREATE TABLE IF NOT EXISTS {} ({});'.format(table, columns))
        print("Table created or already exists.")
    except Exception as e:
        sys.stderr.write("Error creating table: {}\n".format(e))
        raise
    ensure_columns(cur, table, all_keys)
    # Insert each row
    for json_data in json_data_list:
        ensure_columns(cur, table, json_data.keys())
        keys = ', '.join(['"{}"'.format(k) for k in json_data.keys()])
        values = ', '.join(['%s'] * len(json_data))
        try:
            print('Inserting row: {}'.format(json_data))
            cur.execute('INSERT INTO {} ({}) VALUES ({});'.format(table, keys, values), list(json_data.values()))
        except Exception as e:
            sys.stderr.write("Error inserting row: {}\n".format(e))
            raise
    conn.commit()
    cur.close()

def insert_from_api_response(json_data_list):
    """
    Call this function with a list of classified JSON objects (from your API response)
    to insert them into the database.
    """
    insert_dynamic(json_data_list)

if __name__ == "__main__":
    # Read JSON data from stdin (for integration with Node.js or other scripts)
    try:
        input_data = sys.stdin.read()
        if input_data.strip():
            json_data_list = json.loads(input_data)
            insert_from_api_response(json_data_list)
    except Exception as e:
        sys.stderr.write("Error reading or inserting data: {}\n".format(e))
    finally:
        conn.close()
else:
    conn.close()
