-- ============================================================
--  07_RunAll_Pipeline.sql
--  End-to-end pipeline execution script.
--
--  EXECUTION ORDER (run on the SQL Server that hosts all DBs):
--    Step 1 : 01_RawDB_Setup.sql
--    Step 2 : 02_BronzeDB_Setup.sql
--    Step 3 : 03_SilverDB_Setup.sql
--    Step 4 : 04_SP_Source_To_Raw.sql
--    Step 5 : 05_SP_Raw_To_Bronze.sql
--    Step 6 : 06_SP_Bronze_To_Silver.sql
--    Step 7 : THIS FILE — run the full pipeline
--
--  HOW THE PIPELINE WORKS:
--    1. usp_Raw_Load_All        → pulls incremental rows from both
--                                 source DBs into RawDB (two schemas).
--                                 Returns the RawBatchID.
--    2. usp_Brz_Load_All        → reads that RawBatchID, applies UNION
--                                 ALL + transforms into BronzeDB.
--                                 Returns BrzBatchID.
--    3. usp_Slv_Load_All        → reads that BrzBatchID, resolves
--                                 surrogate keys, loads Silver dims
--                                 then facts.
--
--  RE-RUNNING IS SAFE:
--    • MERGE statements in Brz and Slv are idempotent.
--    • Watermarks in RawDB ensure no duplicate raw rows.
--
--  SURROGATE KEY GUARANTEE:
--    CustomerID 1001 from RetailMart  →  CustomerKey = <new INT>
--    CustomerID 2001 from LogiShip    →  CustomerKey = <different INT>
--    Both are uniquely identified by (SourceSystem, SourceCustomerID).
-- ============================================================

USE RawDB;
GO

DECLARE @RawBatchID  INT = 0;
DECLARE @RowsLoaded  INT = 0;
DECLARE @BrzBatchID  INT = 0;

-- ── STEP 1: Source → Raw ────────────────────────────────────
PRINT '╔══════════════════════════════════╗';
PRINT '║  STEP 1 : Source → Raw           ║';
PRINT '╚══════════════════════════════════╝';

EXEC RawDB.dbo.usp_Raw_Load_All;

-- Get the latest RetailMart batch (LogiShip gets its own; bronze needs both)
SELECT TOP 1 @RawBatchID = BatchID
FROM RawDB.dbo.RawLoadLog
WHERE Status = 'Success'
ORDER BY BatchID DESC;

PRINT CONCAT('Raw BatchID (latest success): ', @RawBatchID);

-- ── STEP 2: Raw → Bronze ────────────────────────────────────
PRINT '';
PRINT '╔══════════════════════════════════╗';
PRINT '║  STEP 2 : Raw → Bronze           ║';
PRINT '╚══════════════════════════════════╝';

EXEC BronzeDB.dbo.usp_Brz_Load_All @RawBatchID = @RawBatchID;

SELECT TOP 1 @BrzBatchID = BatchID
FROM BronzeDB.dbo.BrzLoadLog
WHERE Status = 'Success'
ORDER BY BatchID DESC;

PRINT CONCAT('Bronze BatchID (latest success): ', @BrzBatchID);

-- ── STEP 3: Bronze → Silver ─────────────────────────────────
PRINT '';
PRINT '╔══════════════════════════════════╗';
PRINT '║  STEP 3 : Bronze → Silver        ║';
PRINT '╚══════════════════════════════════╝';

EXEC SilverDB.dbo.usp_Slv_Load_All @BrzBatchID = @BrzBatchID;

-- ── PIPELINE SUMMARY ────────────────────────────────────────
PRINT '';
PRINT '╔══════════════════════════════════╗';
PRINT '║  PIPELINE COMPLETE               ║';
PRINT '╚══════════════════════════════════╝';

-- Raw row counts
SELECT 'Raw_RetailMart'   AS Layer, 'Categories'  AS TableName, COUNT(*) AS Rows FROM RawDB.retailmart.Categories  UNION ALL
SELECT 'Raw_RetailMart',            'Products',                  COUNT(*) FROM RawDB.retailmart.Products   UNION ALL
SELECT 'Raw_RetailMart',            'Customers',                 COUNT(*) FROM RawDB.retailmart.Customers  UNION ALL
SELECT 'Raw_RetailMart',            'Orders',                    COUNT(*) FROM RawDB.retailmart.Orders     UNION ALL
SELECT 'Raw_RetailMart',            'OrderItems',                COUNT(*) FROM RawDB.retailmart.OrderItems UNION ALL
SELECT 'Raw_RetailMart',            'Payments',                  COUNT(*) FROM RawDB.retailmart.Payments   UNION ALL
SELECT 'Raw_RetailMart',            'Reviews',                   COUNT(*) FROM RawDB.retailmart.Reviews    UNION ALL
SELECT 'Raw_LogiShip',              'SalesOrders',               COUNT(*) FROM RawDB.logiship.SalesOrders  UNION ALL
SELECT 'Raw_LogiShip',              'Members',                   COUNT(*) FROM RawDB.logiship.Members      UNION ALL
SELECT 'Raw_LogiShip',              'ProductCatalog',            COUNT(*) FROM RawDB.logiship.ProductCatalog
ORDER BY Layer, TableName;

-- Bronze row counts
SELECT 'Bronze' AS Layer, 'br_orders'     AS TableName, COUNT(*) AS Rows FROM BronzeDB.dbo.br_orders      UNION ALL
SELECT 'Bronze',           'br_customers',               COUNT(*) FROM BronzeDB.dbo.br_customers UNION ALL
SELECT 'Bronze',           'br_products',                COUNT(*) FROM BronzeDB.dbo.br_products  UNION ALL
SELECT 'Bronze',           'br_order_items',             COUNT(*) FROM BronzeDB.dbo.br_order_items
ORDER BY TableName;

-- Silver row counts
SELECT 'Silver' AS Layer, 'dim_customer'          AS TableName, COUNT(*) AS Rows FROM SilverDB.dbo.dim_customer         UNION ALL
SELECT 'Silver',           'dim_product',                        COUNT(*) FROM SilverDB.dbo.dim_product          UNION ALL
SELECT 'Silver',           'dim_category',                       COUNT(*) FROM SilverDB.dbo.dim_category         UNION ALL
SELECT 'Silver',           'dim_date',                           COUNT(*) FROM SilverDB.dbo.dim_date             UNION ALL
SELECT 'Silver',           'fact_sales',                         COUNT(*) FROM SilverDB.dbo.fact_sales           UNION ALL
SELECT 'Silver',           'fact_returns',                       COUNT(*) FROM SilverDB.dbo.fact_returns         UNION ALL
SELECT 'Silver',           'fact_inventory_snapshot',            COUNT(*) FROM SilverDB.dbo.fact_inventory_snapshot
ORDER BY TableName;

-- Verify surrogate key uniqueness across sources
SELECT
    'dim_customer cross-source check' AS Check_Name,
    COUNT(*)                          AS TotalRows,
    COUNT(DISTINCT CustomerKey)       AS UniqueKeys,
    SUM(CASE WHEN SourceSystem='RetailMart' THEN 1 ELSE 0 END) AS RM_Rows,
    SUM(CASE WHEN SourceSystem='LogiShip'   THEN 1 ELSE 0 END) AS LS_Rows
FROM SilverDB.dbo.dim_customer
WHERE IsCurrent = 1;
GO
