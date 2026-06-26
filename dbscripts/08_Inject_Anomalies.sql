-- ============================================================
--  08_Inject_Anomalies.sql
--  Injects clearly detectable data anomalies into BronzeDB
--  for use with the Data Alchemist anomaly detection algorithm.
--
--  HOW DETECTION WORKS:
--    The profiling agent reads each table, computes statistics
--    (row count, null rates, value distributions), and compares
--    them against the last 7-day baseline.  Alerts fire when:
--      • VOLUME    — row count shifts by > 2σ from baseline
--      • DISTRIBUTION — null rate or value spread shifts > 20%
--      • THRESHOLD — a metric crosses an absolute threshold
--
--  ANOMALIES INJECTED (4 scenarios):
--    1. VOLUME DROP      — br_orders:       ~93% fewer rows than usual
--    2. EMAIL NULL SPIKE — br_customers:    44% email null rate (normal < 2%)
--    3. ZERO PAYMENTS    — br_payments:     42% of payments have AmountPaid = 0
--    4. BAD QUANTITIES   — br_order_items:  38% of line items have Qty ≤ 0
--
--  USAGE:
--    Run this script against BronzeDB, then run a Profiling scan
--    in Data Alchemist on these tables.  The anomaly inbox will
--    show CRITICAL / HIGH alerts for each scenario below.
--
--  CLEANUP:
--    Run the CLEANUP section at the bottom to remove injected rows.
-- ============================================================

USE BronzeDB;
GO

-- ── Shared batch marker (used in cleanup) ─────────────────────────────────────
--    All injected rows get Brz_BatchID = -9999 so they are easy to delete.
DECLARE @AnomalyBatchID INT = -9999;

PRINT '=================================================================';
PRINT ' Data Alchemist — Anomaly Injection Script';
PRINT ' Batch marker: Brz_BatchID = -9999';
PRINT '=================================================================';
PRINT '';

-- ============================================================
-- ANOMALY 1: VOLUME DROP on br_orders
-- ─────────────────────────────────────────────────────────────
-- WHAT:   A normal daily batch loads ~4,000-4,500 orders.
--         This batch inserts only 280 — a 93% drop.
-- WHY DETECTED:
--         The profiling agent tracks row_count per run.
--         280 is > 3σ below the rolling baseline of ~4,200.
--         → Algorithm fires CRITICAL VOLUME alert.
-- REAL-WORLD CAUSE THIS SIMULATES:
--         ETL pipeline crashed mid-load; Bronze only got the
--         first few pages of the source extract.
-- ============================================================
PRINT 'Injecting Anomaly 1: VOLUME DROP on br_orders (280 rows vs ~4200 normal)...';

INSERT INTO dbo.br_orders
    (SourceSystem, SourceOrderID, SourceCustomerID, OrderDate,
     OrderStatus, GrossAmount, DiscountAmount, TaxAmount,
     ShippingAmount, NetPayable, City, State, PinCode,
     IsDeleted, IsFulfilled, Brz_LoadedAt, Brz_BatchID)
SELECT TOP 280
    'RetailMart'                        AS SourceSystem,
    90000 + ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS SourceOrderID,
    1 + (ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) % 500)  AS SourceCustomerID,
    DATEADD(HOUR, -(ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) % 6), GETDATE()) AS OrderDate,
    CASE (ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) % 5)
        WHEN 0 THEN 'Pending'
        WHEN 1 THEN 'Confirmed'
        WHEN 2 THEN 'Shipped'
        WHEN 3 THEN 'Delivered'
        ELSE 'Cancelled'
    END                                 AS OrderStatus,
    CAST(500 + (ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) % 4500) AS DECIMAL(10,2)) AS GrossAmount,
    CAST(10  + (ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) % 200)  AS DECIMAL(10,2)) AS DiscountAmount,
    CAST(25  + (ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) % 400)  AS DECIMAL(10,2)) AS TaxAmount,
    CAST(40  + (ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) % 100)  AS DECIMAL(10,2)) AS ShippingAmount,
    CAST(470 + (ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) % 4000) AS DECIMAL(10,2)) AS NetPayable,
    'Mumbai'                            AS City,
    'Maharashtra'                       AS State,
    CAST(400000 + (ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) % 99999) AS VARCHAR(10)) AS PinCode,
    0                                   AS IsDeleted,
    0                                   AS IsFulfilled,
    GETDATE()                           AS Brz_LoadedAt,
    @AnomalyBatchID                     AS Brz_BatchID
FROM sys.all_columns c1
    CROSS JOIN sys.all_columns c2;

PRINT CONCAT('  → Inserted ', @@ROWCOUNT, ' rows into br_orders (anomaly batch).');
PRINT '';

-- ============================================================
-- ANOMALY 2: EMAIL NULL SPIKE on br_customers
-- ─────────────────────────────────────────────────────────────
-- WHAT:   500 new customer records are loaded.
--         220 of them (44%) have a NULL Email field.
--         Normal null rate for Email is < 2%.
-- WHY DETECTED:
--         Profiling computes null_rate for each column.
--         44% null rate is > 3σ above the baseline null rate.
--         → Algorithm fires HIGH DISTRIBUTION alert.
-- REAL-WORLD CAUSE THIS SIMULATES:
--         A new data supplier did not include email addresses
--         in their extract; field mapping was missed in ETL.
-- ============================================================
PRINT 'Injecting Anomaly 2: EMAIL NULL SPIKE on br_customers (44% nulls)...';

-- Block A: 280 customers WITH email (normal)
INSERT INTO dbo.br_customers
    (SourceSystem, SourceCustomerID, FirstName, LastName, Email,
     Phone, Gender, LoyaltyTier, RegisteredDate, IsActive,
     CountryCode, Brz_LoadedAt, Brz_BatchID)
SELECT TOP 280
    'RetailMart'  AS SourceSystem,
    80000 + ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS SourceCustomerID,
    'FirstName_'  + CAST(ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS VARCHAR(10)),
    'LastName_'   + CAST(ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS VARCHAR(10)),
    -- email present — normal rows
    'user' + CAST(80000 + ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS VARCHAR(10)) + '@example.com',
    '+91900000' + RIGHT('0000' + CAST(ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) % 9999 AS VARCHAR(4)), 4),
    CASE ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) % 2 WHEN 0 THEN 'M' ELSE 'F' END,
    CASE ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) % 3
        WHEN 0 THEN 'Gold' WHEN 1 THEN 'Silver' ELSE 'Bronze' END,
    DATEADD(DAY, -(ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) % 730), GETDATE()),
    1,
    'IN',
    GETDATE(),
    @AnomalyBatchID
FROM sys.all_columns;

-- Block B: 220 customers WITHOUT email (the anomaly — 44% null rate)
INSERT INTO dbo.br_customers
    (SourceSystem, SourceCustomerID, FirstName, LastName,
     Email,    -- intentionally NULL — this is the anomaly
     Phone, Gender, LoyaltyTier, RegisteredDate, IsActive,
     CountryCode, Brz_LoadedAt, Brz_BatchID)
SELECT TOP 220
    'LogiShip'  AS SourceSystem,
    90000 + ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS SourceCustomerID,
    'Member_'   + CAST(ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS VARCHAR(10)),
    'Surname_'  + CAST(ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS VARCHAR(10)),
    NULL,       -- NO email — this drives the null spike
    '+91800000' + RIGHT('0000' + CAST(ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) % 9999 AS VARCHAR(4)), 4),
    CASE ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) % 2 WHEN 0 THEN 'M' ELSE 'F' END,
    'Bronze',
    DATEADD(DAY, -(ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) % 365), GETDATE()),
    1,
    'IN',
    GETDATE(),
    @AnomalyBatchID
FROM sys.all_columns;

PRINT CONCAT('  → Inserted 280 customers with email + 220 with NULL email (44% null rate).');
PRINT '';

-- ============================================================
-- ANOMALY 3: ZERO / NEGATIVE PAYMENT AMOUNTS on br_payments
-- ─────────────────────────────────────────────────────────────
-- WHAT:   400 payment records are inserted.
--         170 of them (42%) have AmountPaid = 0.
--         A further 30 (7%) have AmountPaid < 0 (refunds misrouted).
--         Normal zero-amount rate: < 0.5%.
-- WHY DETECTED:
--         Profiling checks min/max/mean and zero-value rate.
--         42% zero payments is a massive distribution shift.
--         → Algorithm fires HIGH DISTRIBUTION / THRESHOLD alert.
-- REAL-WORLD CAUSE THIS SIMULATES:
--         Payment gateway returned HTTP 200 with zero amount
--         on timeout; ETL loaded the response without validation.
-- ============================================================
PRINT 'Injecting Anomaly 3: ZERO PAYMENTS on br_payments (42% AmountPaid = 0)...';

-- Block A: 200 valid payments
INSERT INTO dbo.br_payments
    (SourceSystem, SourcePaymentID, SourceOrderID, PaymentDate,
     PaymentMethod, PaymentStatus, AmountPaid, TransactionRef,
     GatewayName, Brz_LoadedAt, Brz_BatchID)
SELECT TOP 200
    'RetailMart'  AS SourceSystem,
    70000 + ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS SourcePaymentID,
    90000 + ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS SourceOrderID,
    DATEADD(MINUTE, -(ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) % 1440), GETDATE()),
    CASE ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) % 4
        WHEN 0 THEN 'Credit Card' WHEN 1 THEN 'UPI'
        WHEN 2 THEN 'Net Banking' ELSE 'Wallet' END,
    'Success',
    CAST(500 + (ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) % 4500) AS DECIMAL(10,2)),
    'TXN' + CAST(700000 + ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS VARCHAR(10)),
    CASE ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) % 3
        WHEN 0 THEN 'Razorpay' WHEN 1 THEN 'PayU' ELSE 'Stripe' END,
    GETDATE(),
    @AnomalyBatchID
FROM sys.all_columns;

-- Block B: 170 zero-amount payments (the anomaly)
INSERT INTO dbo.br_payments
    (SourceSystem, SourcePaymentID, SourceOrderID, PaymentDate,
     PaymentMethod, PaymentStatus, AmountPaid, TransactionRef,
     GatewayName, Brz_LoadedAt, Brz_BatchID)
SELECT TOP 170
    'RetailMart'  AS SourceSystem,
    80000 + ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS SourcePaymentID,
    91000 + ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS SourceOrderID,
    DATEADD(MINUTE, -(ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) % 720), GETDATE()),
    'UPI',
    'Pending',      -- Gateway timed out; amount captured as 0
    0.00,           -- <-- ANOMALY: zero amount
    'TXN_TIMEOUT_' + CAST(ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS VARCHAR(10)),
    'Razorpay',
    GETDATE(),
    @AnomalyBatchID
FROM sys.all_columns;

-- Block C: 30 negative amounts (misrouted refunds)
INSERT INTO dbo.br_payments
    (SourceSystem, SourcePaymentID, SourceOrderID, PaymentDate,
     PaymentMethod, PaymentStatus, AmountPaid, TransactionRef,
     GatewayName, Brz_LoadedAt, Brz_BatchID)
SELECT TOP 30
    'LogiShip'    AS SourceSystem,
    90000 + ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS SourcePaymentID,
    92000 + ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS SourceOrderID,
    DATEADD(MINUTE, -(ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) % 360), GETDATE()),
    'Credit Card',
    'Refunded',
    CAST(-1 * (100 + ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) % 2000) AS DECIMAL(10,2)), -- NEGATIVE
    'REF_' + CAST(ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS VARCHAR(10)),
    'Stripe',
    GETDATE(),
    @AnomalyBatchID
FROM sys.all_columns;

PRINT '  → Inserted 200 valid + 170 zero + 30 negative payment rows.';
PRINT '  → Zero+negative rate = 50% of this batch (normal: < 0.5%).';
PRINT '';

-- ============================================================
-- ANOMALY 4: INVALID QUANTITIES on br_order_items
-- ─────────────────────────────────────────────────────────────
-- WHAT:   600 order line items are inserted.
--         230 of them (38%) have Quantity = 0 or NULL.
--         Normal zero/null quantity rate: < 0.1%.
-- WHY DETECTED:
--         Profiling checks min value and null rate for Quantity.
--         0 quantity makes LineTotalCalc = 0 as well.
--         → Algorithm fires HIGH DISTRIBUTION alert.
-- REAL-WORLD CAUSE THIS SIMULATES:
--         Order management system sent item list before quantities
--         were confirmed; ETL did not wait for the fulfillment signal.
-- ============================================================
PRINT 'Injecting Anomaly 4: INVALID QUANTITIES on br_order_items (38% Qty = 0 or NULL)...';

-- Block A: 370 valid line items
INSERT INTO dbo.br_order_items
    (SourceSystem, SourceLineItemID, SourceOrderID, SourceProductID,
     Quantity, UnitPrice, LineTotal, Discount,
     LineTotalCalc, LineDiscrepancy,
     Brz_LoadedAt, Brz_BatchID)
SELECT TOP 370
    'RetailMart'  AS SourceSystem,
    60000 + ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS SourceLineItemID,
    90000 + (ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) % 280) AS SourceOrderID,
    1    + (ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) % 200)  AS SourceProductID,
    1    + (ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) % 5)    AS Quantity,      -- valid: 1-5
    CAST(100 + (ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) % 4900) AS DECIMAL(10,2)) AS UnitPrice,
    CAST((1 + ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) % 5)
         * (100 + ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) % 4900) AS DECIMAL(10,2)) AS LineTotal,
    CAST(5 + (ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) % 100) AS DECIMAL(10,2)) AS Discount,
    CAST((1 + ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) % 5)
         * (100 + ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) % 4900) AS DECIMAL(10,2)) AS LineTotalCalc,
    0 AS LineDiscrepancy,
    GETDATE(),
    @AnomalyBatchID
FROM sys.all_columns;

-- Block B: 230 items with Quantity = 0 (the anomaly)
INSERT INTO dbo.br_order_items
    (SourceSystem, SourceLineItemID, SourceOrderID, SourceProductID,
     Quantity,   -- ANOMALY: 0 quantity
     UnitPrice, LineTotal, Discount,
     LineTotalCalc, LineDiscrepancy,
     Brz_LoadedAt, Brz_BatchID)
SELECT TOP 230
    'LogiShip'    AS SourceSystem,
    70000 + ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS SourceLineItemID,
    91000 + (ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) % 200) AS SourceOrderID,
    1    + (ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) % 200)  AS SourceProductID,
    0,            -- <-- ANOMALY: zero quantity (item placeholder, not confirmed)
    CAST(100 + (ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) % 2000) AS DECIMAL(10,2)) AS UnitPrice,
    0.00          AS LineTotal,
    0.00          AS Discount,
    0.00          AS LineTotalCalc,  -- 0 * UnitPrice = 0
    0             AS LineDiscrepancy,
    GETDATE(),
    @AnomalyBatchID
FROM sys.all_columns;

PRINT '  → Inserted 370 valid + 230 zero-quantity rows into br_order_items.';
PRINT '  → Zero Quantity rate = 38% (normal: < 0.1%).';
PRINT '';

-- ============================================================
-- SUMMARY
-- ============================================================
PRINT '=================================================================';
PRINT ' Anomaly injection complete. Summary:';
PRINT '';
PRINT '  Table            | Anomaly Type  | Metric              | Expected Alert';
PRINT '  -----------------|---------------|---------------------|----------------';
PRINT '  br_orders        | VOLUME        | 280 rows vs ~4200   | CRITICAL';
PRINT '  br_customers     | DISTRIBUTION  | Email null = 44%    | HIGH';
PRINT '  br_payments      | DISTRIBUTION  | Zero amt   = 50%    | HIGH';
PRINT '  br_order_items   | DISTRIBUTION  | Zero qty   = 38%    | HIGH';
PRINT '';
PRINT ' Next step: Open Data Alchemist → Anomaly Inbox → Run full scan';
PRINT ' The algorithm will detect all 4 anomalies in the profiling stats.';
PRINT '=================================================================';
PRINT '';


-- ============================================================
-- CLEANUP
-- ─────────────────────────────────────────────────────────────
-- Run only when you want to remove the injected anomaly data.
-- Uncomment the block below and execute it.
-- ============================================================
/*
PRINT 'Cleaning up anomaly injection batch (Brz_BatchID = -9999)...';

DELETE FROM dbo.br_order_items WHERE Brz_BatchID = -9999;
PRINT CONCAT('  br_order_items:  ', @@ROWCOUNT, ' rows deleted.');

DELETE FROM dbo.br_payments    WHERE Brz_BatchID = -9999;
PRINT CONCAT('  br_payments:     ', @@ROWCOUNT, ' rows deleted.');

DELETE FROM dbo.br_customers   WHERE Brz_BatchID = -9999;
PRINT CONCAT('  br_customers:    ', @@ROWCOUNT, ' rows deleted.');

DELETE FROM dbo.br_orders      WHERE Brz_BatchID = -9999;
PRINT CONCAT('  br_orders:       ', @@ROWCOUNT, ' rows deleted.');

PRINT 'Cleanup complete.';
*/
GO
