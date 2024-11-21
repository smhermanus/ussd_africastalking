require('dotenv').config();
const xlsx = require('xlsx');
const { Pool } = require('pg');

async function importExcelToNeon(excelFilePath, tableName) {
    console.log('Starting import process...');
    
    // Create database connection
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: {
            rejectUnauthorized: true
        }
    });

    try {
        // Step 1: Read Excel file
        console.log('Reading Excel file...');
        const workbook = xlsx.readFile(excelFilePath);
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const data = xlsx.utils.sheet_to_json(worksheet);

        if (data.length === 0) {
            throw new Error('Excel file is empty');
        }
        console.log(`Found ${data.length} rows in Excel file`);

        // Step 2: Process column names
        const columns = Object.keys(data[0]).map(col => 
            col.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')
        );
        console.log('Columns found:', columns);

        // Step 3: Create table
        const columnDefinitions = columns.map(col => `"${col}" TEXT`).join(', ');
        const createTableQuery = `
            CREATE TABLE IF NOT EXISTS ${tableName} (
                ${columnDefinitions}
            );
        `;
        await pool.query(createTableQuery);
        console.log('Table structure created/verified');

        // Step 4: Insert data
        for (let i = 0; i < data.length; i += 100) {
            const batch = data.slice(i, i + 100);
            const placeholders = batch.map((_, rowIndex) => 
                `(${columns.map((_, colIndex) => 
                    `$${rowIndex * columns.length + colIndex + 1}`
                ).join(', ')})`
            ).join(', ');

            const insertQuery = `
                INSERT INTO ${tableName} 
                ("${columns.join('", "')}") 
                VALUES ${placeholders};
            `;

            const values = batch.flatMap(row => 
                columns.map(col => row[Object.keys(data[0])[columns.indexOf(col)]] || null)
            );

            await pool.query(insertQuery, values);
            console.log(`Imported rows ${i + 1} to ${i + batch.length}`);
        }

        console.log('Import completed successfully!');

    } catch (error) {
        console.error('Error during import:', error.message);
        throw error;

    } finally {
        await pool.end();
    }
}

// Execute the import if running directly
if (require.main === module) {
    const excelFile = process.argv[2];
    const tableName = process.argv[3];

    if (!excelFile || !tableName) {
        console.error('Usage: node import.js <excel-file> <table-name>');
        process.exit(1);
    }

    importExcelToNeon(excelFile, tableName)
        .then(() => process.exit(0))
        .catch(err => {
            console.error(err);
            process.exit(1);
        });
}

module.exports = { importExcelToNeon };