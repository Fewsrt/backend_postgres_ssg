const express = require("express");
const multer = require("multer");
const csvParser = require("csv-parser");
const fs = require("fs");
const { Pool } = require("pg");
const cors = require("cors");
const pm2 = require("pm2");
const bodyParser = require("body-parser");
const admin = require("firebase-admin");
const serviceAccount = require("./.firebase/service-account.json"); // Path to your service account key JSON file
const path = require("path");
const figlet = require("figlet");

const app = express();

figlet("ILMT-SERVER", function (err, data) {
  if (err) {
    console.log("Something went wrong...");
    console.dir(err);
    return;
  }
  console.log(data);
});

app.use(cors());
app.use(bodyParser.json());
const upload = multer({ dest: "uploads/" });

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  storageBucket: "ssgreports-c1304.appspot.com", // Replace 'your-storage-bucket-url' with your Firebase Storage bucket URL
});

const bucket = admin.storage().bucket();

const uploadpdf = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    if (file.mimetype === "application/pdf") {
      cb(null, true);
    } else {
      cb(new Error("Only PDF files are allowed"));
    }
  },
});

// PostgreSQL setup
const pool = new Pool({
  user: "postgres",
  host: "192.168.88.33",
  database: "ilmx_license",
  password: "P@ssw0rdssg",
  port: 5432,
});

function formatTimestamp(timestamp) {
  const date = new Date(timestamp);
  const options = {
    timeZone: "Asia/Bangkok", // GMT+7 (Indochina Time)
    hour12: false, // Use 24-hour format
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  };
  return date
    .toLocaleString("en-US", options)
    .replace(/[/]/g, "-")
    .replace(",", "");
}

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

app.get("/postgres-status", async (req, res) => {
  try {
    // Connect to PostgreSQL and execute a simple query to check the status
    const client = await pool.connect();
    await client.query("SELECT 1");
    client.release();

    // If the query is successful, PostgreSQL is running
    res.json({ status: "running" });
  } catch (error) {
    // If an error occurs, PostgreSQL is not running or there's an issue with the connection
    console.error("Error checking PostgreSQL status:", error);
    res.json({ status: "not running" });
  }
});

app.get("/health", async (req, res) => {
  try {
    // Execute a simple query to check database connectivity
    await pool.query("SELECT 1");
    res.status(200).send("PostgreSQL service is running.");
  } catch (error) {
    console.error("Error checking PostgreSQL service:", error);
    res.status(500).send("PostgreSQL service is not available.");
  }
});

app.get("/status", (req, res) => {
  pm2.list((err, list) => {
    if (err) {
      console.error("Error retrieving process list:", err);
      return res.status(500).json({ error: "Internal Server Error" });
    }

    // Find your application in the process list
    const appProcess = list.find((process) => process.name === "server");

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

// API PDF
// app.post("/api/upload-pdf", uploadpdf.single("file"), async (req, res) => {
//   console.log("PDF file received and processing started...");

//   try {
//     // Access the uploaded file via req.file
//     if (!req.file) {
//       throw new Error("No file uploaded");
//     }

//     // Upload the file to Firebase Storage
//     const fileName = `${
//       path.parse(req.file.originalname).name
//     }-${Date.now()}${path.extname(req.file.originalname)}`;
//     const file = bucket.file("pdfs/" + fileName);

//     await file.save(req.file.buffer, {
//       metadata: {
//         contentType: req.file.mimetype,
//       },
//     });

//     console.log("File uploaded successfully to Firebase Storage.");

//     // Get the download URL of the uploaded file
//     const downloadUrl = await file.getSignedUrl({
//       action: "read",
//       expires: "03-01-2500", // Expiry date for the URL (adjust as needed)
//     });

//     // Format the current date and time to Bangkok time (GMT+7)
//     const currentDate = formatTimestamp(Date.now());

//     // Insert the filename, download link, and current date into the PostgreSQL database
//     const insertQuery =
//       "INSERT INTO pdflink (filename, downloadlink, date) VALUES ($1, $2, $3)";
//     await pool.query(insertQuery, [fileName, downloadUrl[0], currentDate]);

//     console.log("PDF file information saved to PostgreSQL.");

//     // Send a success response
//     res.status(200).send({
//       message: "File uploaded successfully.",
//     });
//   } catch (error) {
//     console.error("Error uploading file:", error);
//     res.status(500).send("Error uploading file: " + error.message);
//   }
// });

app.post("/api/upload-pdf", uploadpdf.single("file"), async (req, res) => {
  console.log("PDF file received and processing started...");

  try {
    // Access the form data sent from the frontend
    const ibmAgreementNumber = req.body.ibmAgreementNumber;
    const ibmSiteNumber = req.body.ibmSiteNumber;
    const ibmCustomerNumber = req.body.ibmCustomerNumber;
    const ibmOrderRefNumber = req.body.ibmOrderRefNumber;
    const ibmOrderRefDate = req.body.ibmOrderRefDate;
    const selectedLicenses = JSON.parse(req.body.selectedLicenses);

    // Access the uploaded file via req.file
    if (!req.file) {
      throw new Error("No file uploaded");
    }

    // Upload the file to Firebase Storage
    const fileName = `${
      path.parse(req.file.originalname).name
    }-${Date.now()}${path.extname(req.file.originalname)}`;
    const file = bucket.file("pdfs/" + fileName);

    await file.save(req.file.buffer, {
      metadata: {
        contentType: req.file.mimetype,
      },
    });

    console.log("File uploaded successfully to Firebase Storage.");

    // Get the download URL of the uploaded file
    const downloadUrl = await file.getSignedUrl({
      action: "read",
      expires: "03-01-2500", // Expiry date for the URL (adjust as needed)
    });

    // Format the current date and time to Bangkok time (GMT+7)
    const currentDate = formatTimestamp(Date.now());

    // Insert the filename, download link, and form data into the PostgreSQL database
    const insertQuery =
      "INSERT INTO pdflink (filename, ibm_agreement_number, ibm_site_number, ibm_customer_number, ibm_order_ref_number, ibm_order_ref_date, selected_licenses, date, downloadlink) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)";
    await pool.query(insertQuery, [
      fileName,
      ibmAgreementNumber,
      ibmSiteNumber,
      ibmCustomerNumber,
      ibmOrderRefNumber,
      ibmOrderRefDate,
      selectedLicenses,
      currentDate,
      downloadUrl[0],
    ]);

    console.log("PDF file information saved to PostgreSQL.");

    // Send a success response
    res.status(200).send({
      message: "File uploaded successfully.",
    });
  } catch (error) {
    console.error("Error uploading file:", error);
    res.status(500).send("Error uploading file: " + error.message);
  }
});

// Route to delete data from PostgreSQL and Firebase Storage
app.delete("/api/delete-pdf/:id", async (req, res) => {
  const id = req.params.id;

  try {
    // Query the PostgreSQL database to get the filename and download link
    const queryResult = await pool.query(
      "SELECT filename, downloadlink FROM pdflink WHERE id = $1",
      [id]
    );
    if (queryResult.rows.length === 0) {
      return res.status(404).send("PDF file not found");
    }

    const { filename, downloadlink } = queryResult.rows[0];

    // Delete the file from Firebase Storage
    const file = bucket.file("pdfs/" + filename);
    await file.delete();

    console.log("File deleted successfully from Firebase Storage.");

    // Delete the record from PostgreSQL
    await pool.query("DELETE FROM pdflink WHERE id = $1", [id]);

    console.log("PDF file information deleted from PostgreSQL.");

    // Send a success response
    res.status(200).send({
      message: "File deleted successfully.",
      filename,
      downloadlink,
    });
  } catch (error) {
    console.error("Error deleting file:", error);
    res.status(500).send("Error deleting file: " + error.message);
  }
});

app.get("/api/get-pdf-files", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM pdflink");
    const pdfFiles = result.rows;
    res.json(pdfFiles);
  } catch (error) {
    console.error("Error fetching PDF files:", error);
    res.status(500).json({ error: "Error fetching PDF files" });
  }
});

// Endpoint to check if the table name exists
app.get("/api/check-table-exists", async (req, res) => {
  const { tableName } = req.query;

  try {
    const query =
      "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = $1)";
    const result = await pool.query(query, [tableName]);

    // Extract the result from the query
    const tableExists = result.rows[0].exists;

    res.json({ exists: tableExists });
  } catch (error) {
    console.error("Error checking table name:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/api/check-filename/:filename", async (req, res) => {
  try {
    const { filename } = req.params;

    // Check if the filename matches any existing table names in the database
    const tableName = filename.replace(/\.[^/.]+$/, ""); // Remove file extension
    const existingTableNames = await getAllTableNamesFromDatabase(); // Wait for the Promise to resolve
    const filenameMatches = existingTableNames.includes(tableName);
    console.log(filenameMatches);

    res.json({ exists: filenameMatches });
  } catch (error) {
    console.error("Error checking filename:", error);
    res.status(500).json({ error: "Error checking filename" });
  }
});

function getAllTableNamesFromDatabase() {
  return new Promise((resolve, reject) => {
    pool.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'",
      (error, result) => {
        if (error) {
          console.error("Error fetching table names:", error);
          reject(error);
        } else {
          const tableNames = result.rows.map((row) => row.table_name);
          resolve(tableNames);
        }
      }
    );
  });
}

// API CSV
app.post("/api/upload-csv", upload.single("file"), (req, res) => {
  console.log("CSV file received and processing started...");
  const { environment, selectedMonth, selectedYear } = req.body;

  const file = req.file;
  if (!file) {
    return res.status(400).json({ error: "No file uploaded" });
  }

  const tableName = generateTableName(environment, selectedMonth, selectedYear);
  console.log("Generated table name:", tableName);

  const results = []; // Initialize results array

  fs.createReadStream(file.path)
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

function generateTableName(environment, selectedMonth, selectedYear) {
  // Concatenate the environment, selected month, and selected year
  const tableName = `${environment}_${selectedMonth}_${selectedYear}`;
  // Remove any special characters from the table name
  const cleanTableName = tableName.replace(/[^\w\s]/gi, "");
  return cleanTableName;
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

app.delete("/api/delete-table/:tableName", async (req, res) => {
  const { tableName } = req.params;

  try {
    await pool.query(`DROP TABLE IF EXISTS ${tableName}`);
    console.log(`Table ${tableName} deleted successfully.`);
    res
      .status(200)
      .send({ message: `Table ${tableName} deleted successfully.` });
  } catch (error) {
    console.error("Error deleting table:", error);
    res.status(500).send("Error deleting table: " + error.message);
  }
});

app.post("/api/create-table", (req, res) => {
  const { tableName, columns } = req.body;

  if (!tableName) {
    return res.status(400).json({ error: "Table name is required" });
  }

  if (!columns || columns.length === 0) {
    return res.status(400).json({ error: "At least one column is required" });
  }

  // Constructing column definitions
  const columnDefinitions = columns
    .map((columnName) => `${columnName} VARCHAR(255)`)
    .join(", ");

  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS ${tableName} (
      id SERIAL PRIMARY KEY,
      ${columnDefinitions}
    )
  `;

  pool
    .query(createTableQuery)
    .then(() => {
      res
        .status(200)
        .json({ message: `Table ${tableName} created successfully` });
    })
    .catch((error) => {
      console.error("Error creating table:", error);
      res.status(500).json({ error: "Error creating table" });
    });
});

app.post("/api/add-license-mapping", async (req, res) => {
  const { productName, licenseName } = req.body;

  if (!productName || !licenseName) {
    return res
      .status(400)
      .json({ error: "Product Name and License Name are required" });
  }

  try {
    let newId;

    // Retrieve the last used ID from the database
    const lastIdQuery = "SELECT MAX(id) FROM mappinglicense";
    const lastIdResult = await pool.query(lastIdQuery);
    const lastId = lastIdResult.rows[0].max;

    // If there are no records in the table, start with ID 1
    if (!lastId) {
      newId = 1;
    } else {
      // Increment the last used ID by 1 for the new record
      newId = lastId + 1;
    }

    // Insert the new data into the table with the calculated ID
    const insertQuery =
      "INSERT INTO mappinglicense (id, product_name, license_name) VALUES ($1, $2, $3)";
    await pool.query(insertQuery, [newId, productName, licenseName]);

    res.status(200).json({ message: "Data created successfully", id: newId });
  } catch (error) {
    console.error("Error creating data:", error);
    res.status(500).json({ error: "Error creating data" });
  }
});

app.get("/api/table-data-license", async (req, res) => {
  try {
    const queryText = "SELECT * FROM mappinglicense";
    const result = await pool.query(queryText);
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching license mappings:", error);
    res.status(500).send("Internal server error");
  }
});

app.put("/api/update-data/:id", async (req, res) => {
  const id = req.params.id;
  const { productName, licenseName, datacollection } = req.body;

  try {
    const queryText =
      "UPDATE mappinglicense SET product_name = $1, license_name = $2, data_collection = $3 WHERE id = $4";
    await pool.query(queryText, [productName, licenseName, datacollection, id]);
    res.status(200).send("License mapping updated successfully");
  } catch (error) {
    console.error("Error updating license mapping:", error);
    res.status(500).send("Internal server error");
  }
});

app.delete("/api/delete-data/:id", async (req, res) => {
  const id = req.params.id;

  try {
    const queryText = "DELETE FROM mappinglicense WHERE id = $1";
    await pool.query(queryText, [id]);
    res.status(200).send("License mapping deleted successfully");
  } catch (error) {
    console.error("Error deleting license mapping:", error);
    res.status(500).send("Internal server error");
  }
});

app.post("/api/reset-table", async (req, res) => {
  try {
    // Delete all records from the table
    await pool.query("DELETE FROM mappinglicense");

    // Reset the sequence for the ID column to start from 1
    await pool.query("ALTER SEQUENCE mappinglicense_id_seq RESTART WITH 1");

    res.status(200).json({ message: "Table reset successfully" });
  } catch (error) {
    console.error("Error resetting table:", error);
    res.status(500).json({ error: "Error resetting table" });
  }
});

app.post("/api/store-results", (req, res) => {
  const resultsToStore = req.body;

  // Insert each result into the database
  resultsToStore.forEach((result) => {
    const {
      componentName,
      pvuMin,
      pvuMax,
      LicenseVPC,
      LPARLicense,
      NonLPARLicense,
      date,
      tablename,
    } = result;
    const query = `
      INSERT INTO calculation_results (component_name, pvu_min, pvu_max, license_vpc, lpar_license, non_lpar_license, calculation_date, tablename)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `;
    const values = [
      componentName,
      pvuMin,
      pvuMax,
      LicenseVPC,
      LPARLicense,
      NonLPARLicense,
      date,
      tablename,
    ];

    // Execute the query
    pool.query(query, values, (err, result) => {
      if (err) {
        console.error("Error storing calculation result:", err);
        res.status(500).send("Error storing calculation result");
      } else {
        console.log("Calculation result stored successfully");
      }
    });
  });

  res.status(200).send("Calculation results stored successfully");
});

app.post("/api/update-data-collection", async (req, res) => {
  const { productName, newDataCollection } = req.body;

  try {
    // Check if any of the values in newDataCollection are not zero
    const nonZeroValues = Object.values(newDataCollection).filter(
      (value) => value !== 0
    );

    if (nonZeroValues.length > 0) {
      const query = `
        UPDATE mappinglicense
        SET data_collection = $1
        WHERE product_name = $2;
      `;

      // Execute the query
      await pool.query(query, [nonZeroValues.join(","), productName]);

      res
        .status(200)
        .json({ message: "Data collection updated successfully." });
    } else {
      console.log("No non-zero values found. Data not saved.");
      res
        .status(200)
        .json({ message: "No non-zero values found. Data not saved." });
    }
  } catch (error) {
    console.error("Error updating data collection:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// API endpoint to handle POST request for retrieving calculation results based on selected table names
app.post("/api/get-calculation-results", (req, res) => {
  const { tableNames } = req.body;

  // Construct SQL query to retrieve calculation results based on selected table names
  const query = `
    SELECT * FROM calculation_results
    WHERE tablename IN (${tableNames
      .map((_, index) => `$${index + 1}`)
      .join(", ")})
  `;

  // Execute the query with tableNames as parameters
  pool.query(query, tableNames, (err, result) => {
    if (err) {
      console.error("Error retrieving calculation results:", err);
      res.status(500).json({ error: "Error retrieving calculation results" });
    } else {
      // Send the retrieved calculation results as JSON response
      res.status(200).json(result.rows);
    }
  });
});

// API endpoint to handle DELETE request for deleting data based on ID
app.delete("/api/calculation-results/:id", (req, res) => {
  const { id } = req.params;

  // Construct SQL query to delete data from the calculation_results table based on the provided ID
  const query = "DELETE FROM calculation_results WHERE id = $1";

  // Execute the query with the provided ID as parameter
  pool.query(query, [id], (err, result) => {
    if (err) {
      console.error("Error deleting data:", err);
      res.status(500).json({ error: "Error deleting data" });
    } else {
      // Send a success response if deletion is successful
      res.status(200).json({ message: "Data deleted successfully" });
    }
  });
});

app.listen(process.env.PORT, () => {});
