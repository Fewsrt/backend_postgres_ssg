const express = require("express");
const multer = require("multer");
const csvParser = require("csv-parser");
const fs = require("fs");
const { Pool } = require("pg");
const cors = require("cors");
const pm2 = require('pm2');

const app = express();

app.use(cors());
const upload = multer({ dest: "uploads/" });

// PostgreSQL setup
const pool = new Pool({
  user: "postgres",
  host: "192.168.88.33",
  database: "ilmx_license",
  password: "P@ssw0rdssg",
  port: 5432,
});

// Function to generate a table name based on the uploaded file name with timestamp
function generateTableName(fileName) {
  // Remove file extension and special characters from the file name
  const cleanFileName = fileName
    .replace(/\.[^/.]+$/, "")
    .replace(/[^\w\s]/gi, "");

  // Concatenate the clean file name with timestamp
  return `${cleanFileName}`;
}

app.post("/api/upload-csv", upload.single("file"), (req, res) => {
  console.log("CSV file received and processing started...");

  const file = req.file;
  if (!file) {
    return res.status(400).json({ error: "No file uploaded" });
  }

  const tableName = generateTableName(file.originalname);
  console.log("Generated table name:", tableName);

  const results = []; // Initialize results array

  const stream = fs
    .createReadStream(file.path)
    .pipe(csvParser())
    .on("error", (error) => {
      console.error("Error parsing CSV file:", error);
      res.status(500).json({ error: "Error parsing CSV file" });
    })
    .on("data", (data) => {
      results.push(data); // Store data in the results array
    })
    .on("end", () => {
      createTableFromCSV(results, tableName, res); // Pass results array to createTableFromCSV function
    });
});

function createTableFromCSV(results, tableName, res) {
  if (!results || results.length === 0) {
    return res.status(400).json({ error: "No data in CSV file" });
  }

  const columnNames = Object.keys(results[0]); // Extract column names from the first row

  // Construct the CREATE TABLE query dynamically using the column names
  const createTableQuery = `
      CREATE TABLE IF NOT EXISTS ${tableName} (
        id SERIAL PRIMARY KEY,
        ${columnNames.map((name) => `"${name}" VARCHAR(255)`).join(",\n")}
      )
    `;

  pool.query(createTableQuery, (err) => {
    if (err) {
      console.error("Error creating table:", err);
      return res.status(500).json({ error: "Error creating table" });
    }

    // Construct the INSERT INTO query
    const placeholders = columnNames
      .map((_, index) => `$${index + 1}`)
      .join(", ");
    const insertQuery = `INSERT INTO ${tableName} ("${columnNames.join(
      '", "'
    )}") VALUES (${placeholders})`;

    const insertPromises = results.map((row) => {
      const values = Object.values(row);
      return new Promise((resolve, reject) => {
        pool.query(insertQuery, values, (err) => {
          if (err) {
            console.error("Error inserting data into table:", err);
            reject(err);
          } else {
            resolve();
          }
        });
      });
    });

    Promise.all(insertPromises)
      .then(() => {
        console.log("CSV data processed successfully");
        res.status(200).json({ message: "CSV data processed successfully" });
      })
      .catch((error) => {
        console.error("Error inserting data into table:", error);
        res.status(500).json({ error: "Error inserting data into table" });
      });
  });
}

app.get("/api/table-names", (req, res) => {
  pool.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'",
    (error, result) => {
      if (error) {
        console.error("Error fetching table names:", error);
        return res.status(500).json({ error: "Error fetching table names" });
      }
      const tableNames = result.rows.map((row) => row.table_name);
      res.json(tableNames);
    }
  );
});

// API endpoint to fetch rows of data for a specific table
app.get("/api/table-data/:tableName", (req, res) => {
  const tableName = req.params.tableName;
  pool.query(`SELECT * FROM ${tableName}`, (error, result) => {
    if (error) {
      console.error(`Error fetching data from table ${tableName}:`, error);
      return res
        .status(500)
        .json({ error: `Error fetching data from table ${tableName}` });
    }
    res.json(result.rows);
  });
});

app.post("/deploy", (req, res) => {
  // Execute the deployment script
  const { exec } = require("child_process");
  const deployScript = exec("sh deploy.sh");

  // Log script output
  deployScript.stdout.on("data", (data) => {
    console.log(`stdout: ${data}`);
  });

  deployScript.stderr.on("data", (data) => {
    console.error(`stderr: ${data}`);
  });

  // Respond to the webhook request
  res.status(200).send("Deployment initiated");
});

app.get("/status", (req, res) => {
  pm2.list((err, list) => {
    if (err) {
      console.error("Error retrieving process list:", err);
      return res.status(500).json({ error: "Internal Server Error" });
    }

    // Find your application in the process list
    const appProcess = list.find((process) => process.name === "your-app-name");

    if (!appProcess) {
      return res.status(404).json({ error: "Application not found" });
    }

    // Construct and send the response
    const response = {
      name: appProcess.name,
      status: appProcess.pm2_env.status,
      pid: appProcess.pid,
      memory: appProcess.monit.memory,
      cpu: appProcess.monit.cpu,
      // Add more fields as needed
    };
    res.json(response);
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
