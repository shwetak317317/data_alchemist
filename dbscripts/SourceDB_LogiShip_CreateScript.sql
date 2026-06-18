-- ============================================================
--  SourceDB_LogiShip  |  AI Data Trust Project  (v2 — redesigned)
--  E-Commerce Source #2 : Independent ecommerce platform
--  (think: a second seller portal like a regional marketplace)
--
--  THIS SOURCE NOW MIRRORS THE SAME BUSINESS DOMAIN AS RETAILMART:
--    Products, Customers, Orders, Payments, Reviews, Promotions
--  with DIFFERENT table names, column names, and conventions —
--  exactly as two real-world source systems would look.
--
--  ADDITIONAL TABLES (logistics extension, LogiShip-only):
--    Warehouses, Shipments, Returns, Suppliers,
--    StockLedger, ProcurementOrders
--
--  UNION PAIRS (Bronze layer):
--    ProductCategories  ←→  RetailMart.Categories
--    ProductCatalog     ←→  RetailMart.Products
--    Members            ←→  RetailMart.Customers
--    Deals              ←→  RetailMart.Promotions
--    SalesOrders        ←→  RetailMart.Orders
--    SalesOrderLines    ←→  RetailMart.OrderItems
--    Transactions       ←→  RetailMart.Payments
--    ProductReviews     ←→  RetailMart.Reviews
--
--  NO FK CONSTRAINTS enforced (same pattern as RetailMart).
--  All tables carry UpdatedTs for incremental load watermarking.
-- ============================================================

USE master;
GO

IF EXISTS (SELECT name FROM sys.databases WHERE name = N'SourceDB_LogiShip')
BEGIN
    ALTER DATABASE SourceDB_LogiShip SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
    DROP DATABASE SourceDB_LogiShip;
END
GO

CREATE DATABASE SourceDB_LogiShip
    COLLATE SQL_Latin1_General_CP1_CI_AS;
GO
USE SourceDB_LogiShip;
GO

-- ============================================================
-- TABLE: ProductCategories
-- Mirrors: RetailMart.Categories
-- Differences: CatID, CatName, ParentCatID, ActiveFlag, CreatedTs
-- ============================================================
CREATE TABLE ProductCategories (
    CatID        INT           NOT NULL PRIMARY KEY,
    CatName      VARCHAR(100)  NULL,           -- nullable: NULL is seeded anomaly
    ParentCatID  INT           NULL,
    ActiveFlag   BIT           NOT NULL DEFAULT 1,
    CreatedTs    DATETIME      NOT NULL DEFAULT GETDATE(),
    UpdatedTs    DATETIME      NOT NULL DEFAULT GETDATE()
);

INSERT INTO ProductCategories (CatID, CatName, ParentCatID, ActiveFlag) VALUES
( 1, 'Electronics',         NULL, 1),
( 2, 'Mobile Phones',       1,    1),
( 3, 'Computers',           1,    1),
( 4, 'Apparel',             NULL, 1),
( 5, 'Mens Wear',           4,    1),
( 6, 'Womens Wear',         4,    1),
( 7, 'Home & Living',       NULL, 1),
( 8, 'Kitchen',             7,    1),
( 9, 'Furniture',           7,    1),
(10, 'Sports',              NULL, 1),
(11, 'Gym & Fitness',       10,   1),
(12, 'Books & Media',       NULL, 1),
(13, 'Fiction',             12,   1),
(14, 'Non-Fiction',         12,   1),
(15, 'Tablets & iPads',     1,    1),
(16, 'Accessories',         1,    1),
-- [ANOMALY-LS-01] NULL CatName
(17, NULL,                  1,    1),
-- [ANOMALY-LS-02] Duplicate CatName
(18, 'Electronics',         NULL, 1),
-- [ANOMALY-LS-03] ParentCatID referencing non-existent parent
(19, 'Smart Home',          999,  1);
GO

-- ============================================================
-- TABLE: ProductCatalog
-- Mirrors: RetailMart.Products
-- Differences: ProdID, ProdTitle, BarCode, ListPrice, AvailableQty,
--              WeightGrams (vs Weight_kg), ReleaseDt, LastUpdatedTs
-- ============================================================
CREATE TABLE ProductCatalog (
    ProdID        INT            NOT NULL PRIMARY KEY,
    ProdTitle     VARCHAR(255)   NOT NULL,
    CatID         INT            NULL,           -- no FK enforced
    BarCode       VARCHAR(50)    NOT NULL UNIQUE,
    ListPrice     DECIMAL(10,2)  NOT NULL,
    PurchasePrice DECIMAL(10,2)  NULL,
    AvailableQty  INT            NOT NULL DEFAULT 0,
    WeightGrams   DECIMAL(10,2)  NULL,           -- note: grams, not kg
    ActiveFlag    BIT            NOT NULL DEFAULT 1,
    ReleaseDt     DATE           NULL,
    CreatedTs     DATETIME       NOT NULL DEFAULT GETDATE(),
    LastUpdatedTs DATETIME       NOT NULL DEFAULT GETDATE()
);

INSERT INTO ProductCatalog (ProdID, ProdTitle, CatID, BarCode, ListPrice, PurchasePrice, AvailableQty, WeightGrams, ActiveFlag, ReleaseDt) VALUES
( 1, 'OnePlus 12 5G',                    2,  'BAR-OP-12-5G-BLK',   699.00,  420.00, 180,  200.0, 1, '2024-01-23'),
( 2, 'Redmi Note 13 Pro',                2,  'BAR-RD-N13P-BLU',    349.00,  180.00, 300,  187.0, 1, '2023-10-19'),
( 3, 'Asus ROG Strix G16',              3,  'BAR-AS-ROG-G16',    1499.00,  900.00,  60, 2300.0, 1, '2024-02-14'),
( 4, 'HP Pavilion 15',                   3,  'BAR-HP-PAV15-SLV',   749.00,  450.00,  95, 1800.0, 1, '2023-08-01'),
( 5, 'Roadster Slim Fit Jeans Men',      5,  'BAR-RS-SLM-32W',      59.99,   22.00, 600,  650.0, 1, '2022-05-01'),
( 6, 'Nike React Infinity Run Men',      5,  'BAR-NK-RIR-M10',     160.00,   65.00, 250,  480.0, 1, '2023-03-15'),
( 7, 'H&M Floral Wrap Dress',            6,  'BAR-HM-FWD-S',        39.99,   12.00, 500,  230.0, 1, '2023-05-20'),
( 8, 'Prestige Induction Cooktop',       8,  'BAR-PR-IND-09',        89.00,   35.00, 200, 2900.0, 1, '2021-09-01'),
( 9, 'iRobot Roomba i3',                8,  'BAR-IR-R-I3',         349.99,  175.00,  80, 3400.0, 1, '2022-07-01'),
(10, 'Pepperfry Olivia 3-Seater Sofa',   9,  'BAR-PF-SOF-3ST',     599.00,  200.00,  40,85000.0, 1, '2020-06-01'),
(11, 'Decathlon Dumbbell Set 20kg',      11, 'BAR-DK-DB20-BLK',    119.00,   50.00, 100,20000.0, 1, '2022-01-01'),
(12, 'Rich Dad Poor Dad',               14, 'BAR-BK-RDPD',          14.99,    4.00,1200,  290.0, 1, '1997-04-01'),
(13, 'The Alchemist',                   13, 'BAR-BK-ALC-PC',        12.99,    3.50, 900,  265.0, 1, '1988-01-01'),
(14, 'boAt Rockerz 450 Headphones',      1,  'BAR-BT-R450-BLU',     49.99,   18.00, 500,  200.0, 1, '2021-06-01'),
(15, 'Samsung Galaxy Tab S9',            15, 'BAR-SM-TABS9-GRY',   699.00,  420.00, 130,  498.0, 1, '2023-08-11'),
(16, 'Mi OLED TV 55"',                   1,  'BAR-MI-OL55',         999.99,  560.00,  45,21000.0, 1, '2023-04-01'),
(17, 'Bajaj Majesty OFX 7 Fryer',        8,  'BAR-BJ-OFX7',          89.99,   36.00, 180, 3100.0, 1, '2022-10-01'),
(18, 'Puma Cali Women Sneakers',         6,  'BAR-PM-CALI-W7',      120.00,   48.00, 300,  420.0, 1, '2023-01-01'),
(19, 'Kobo Libra 2 Ereader',             1,  'BAR-KB-LIB2-WHT',    179.99,   80.00, 220,  215.0, 1, '2022-10-01'),
(20, 'De Longhi Dedica Espresso',        8,  'BAR-DL-DED-EC685',   299.99,  120.00, 100, 4600.0, 1, '2021-03-01'),
-- [ANOMALY-LS-04] Negative ListPrice
(21, 'Ghost Listing Alpha',              1,  'BAR-ERR-001',          -5.00,    8.00,  50,  100.0, 1, '2024-01-01'),
-- [ANOMALY-LS-05] ListPrice = 0
(22, 'Free Sample Pack',                 4,  'BAR-ERR-002',           0.00,    1.50, 100,   50.0, 1, '2024-01-01'),
-- [ANOMALY-LS-06] PurchasePrice > ListPrice (margin inversion)
(23, 'Undercosted Gadget',               1,  'BAR-ERR-003',          19.99,  200.00,  80,  180.0, 1, '2024-01-01'),
-- [ANOMALY-LS-07] Future ReleaseDt
(24, 'Upcoming Phone X100',              2,  'BAR-ERR-004',         999.00,  500.00,   0,  210.0, 1, '2099-06-01'),
-- [ANOMALY-LS-08] Negative AvailableQty
(25, 'Phantom Stock Item',               1,  'BAR-ERR-005',          39.99,   15.00,-150,  100.0, 1, '2023-01-01'),
-- [ANOMALY-LS-09] Invalid CatID (no FK enforced)
(26, 'Orphan Catalog Item',            888,  'BAR-ERR-006',          49.99,   20.00,  10,  150.0, 1, '2023-06-01');
GO

-- ============================================================
-- TABLE: Members
-- Mirrors: RetailMart.Customers
-- Differences: MemberID, GivenName, Surname, EmailAddr, MobileNo,
--              BirthDate, GenderCode, MembershipLevel, JoinedDt,
--              ActiveFlag, CountryISO
-- ============================================================
CREATE TABLE Members (
    MemberID         INT           NOT NULL PRIMARY KEY,
    GivenName        VARCHAR(100)  NOT NULL,
    Surname          VARCHAR(100)  NOT NULL,
    EmailAddr        VARCHAR(255)  NULL,          -- nullable: NULL is seeded anomaly
    MobileNo         VARCHAR(20)   NULL,
    BirthDate        DATE          NULL,
    GenderCode       CHAR(1)       NULL,
    MembershipLevel  VARCHAR(20)   NULL,
    JoinedDt         DATETIME      NOT NULL DEFAULT GETDATE(),
    ActiveFlag       BIT           NOT NULL DEFAULT 1,
    CountryISO       CHAR(2)       NULL,
    UpdatedTs        DATETIME      NOT NULL DEFAULT GETDATE()
);

INSERT INTO Members (MemberID, GivenName, Surname, EmailAddr, MobileNo, BirthDate, GenderCode, MembershipLevel, JoinedDt, ActiveFlag, CountryISO) VALUES
(2001, 'Rohan',    'Agarwal',    'rohan.agarwal@mail.com',    '+91-9700011111', '1991-03-10', 'M', 'Gold',     '2019-05-14', 1, 'IN'),
(2002, 'Neha',     'Sharma',     'neha.sharma@mail.com',      '+91-9700022222', '1986-08-19', 'F', 'Platinum', '2018-09-01', 1, 'IN'),
(2003, 'Aditya',   'Verma',      'aditya.verma@mail.com',     '+91-9700033333', '1994-11-25', 'M', 'Silver',   '2021-02-20', 1, 'IN'),
(2004, 'Priyanka', 'Singh',      'priyanka.singh@mail.com',   '+91-9700044444', '1990-06-14', 'F', 'Bronze',   '2022-01-10', 1, 'IN'),
(2005, 'Sanjay',   'Gupta',      'sanjay.gupta@mail.com',     '+91-9700055555', '1983-01-28', 'M', 'Gold',     '2020-07-05', 1, 'IN'),
(2006, 'Ritika',   'Joshi',      'ritika.joshi@mail.com',     '+91-9700066666', '1998-04-03', 'F', 'Silver',   '2022-06-18', 1, 'IN'),
(2007, 'Deepak',   'Nair',       'deepak.nair@mail.com',      '+91-9700077777', '1980-12-07', 'M', 'Platinum', '2017-11-30', 1, 'IN'),
(2008, 'Anjali',   'Pillai',     'anjali.pillai@mail.com',    '+91-9700088888', '2000-07-22', 'F', 'Bronze',   '2023-03-01', 1, 'IN'),
(2009, 'Mohit',    'Malhotra',   'mohit.malhotra@mail.com',   '+91-9700099999', '1992-09-05', 'M', 'Gold',     '2020-10-12', 1, 'IN'),
(2010, 'Shweta',   'Dubey',      'shweta.dubey@mail.com',     '+91-9700010101', '1995-02-16', 'F', 'Silver',   '2021-08-25', 1, 'IN'),
(2011, 'Vivek',    'Srivastava', 'vivek.sri@mail.com',        '+91-9700011211', '1988-06-30', 'M', 'Platinum', '2018-04-14', 1, 'IN'),
(2012, 'Pooja',    'Yadav',      'pooja.yadav@mail.com',      '+91-9700012321', '1997-09-11', 'F', 'Bronze',   '2023-07-08', 1, 'IN'),
(2013, 'Aryan',    'Kapoor',     'aryan.kapoor@mail.com',     '+91-9700013431', '1993-01-19', 'M', 'Gold',     '2019-12-02', 1, 'IN'),
(2014, 'Shruti',   'Bhatt',      'shruti.bhatt@mail.com',     '+91-9700014541', '1989-11-04', 'F', 'Silver',   '2021-05-17', 1, 'IN'),
(2015, 'Kunal',    'Mehrotra',   'kunal.mehrotra@mail.com',   '+91-9700015651', '1985-07-26', 'M', 'Platinum', '2016-08-09', 1, 'IN'),
(2016, 'Nidhi',    'Chauhan',    'nidhi.chauhan@mail.com',    '+91-9700016761', '1999-03-08', 'F', 'Bronze',   '2023-04-22', 1, 'IN'),
(2017, 'Sameer',   'Bajaj',      'sameer.bajaj@mail.com',     '+91-9700017871', '1991-10-15', 'M', 'Silver',   '2021-11-14', 1, 'IN'),
(2018, 'Tanvi',    'Menon',      'tanvi.menon@mail.com',      '+91-9700018981', '1996-05-20', 'F', 'Gold',     '2020-03-31', 1, 'IN'),
(2019, 'Pranav',   'Khanna',     'pranav.khanna@mail.com',    '+91-9700019191', '1987-08-02', 'M', 'Silver',   '2021-09-28', 1, 'IN'),
(2020, 'Divya',    'Rastogi',    'divya.rastogi@mail.com',    '+91-9700020202', '1994-12-17', 'F', 'Bronze',   '2022-10-05', 1, 'IN'),
-- [ANOMALY-LS-10] NULL EmailAddr
(2021, 'Abhay',    'Saxena',     NULL,                        '+91-9700021212', '1990-04-22', 'M', 'Bronze',   '2023-06-01', 1, 'IN'),
-- [ANOMALY-LS-11] Malformed EmailAddr
(2022, 'Bhavna',   'Trivedi',    'invalid-email-format',      '+91-9700022322', '1987-10-08', 'F', 'Silver',   '2022-12-15', 1, 'IN'),
-- [ANOMALY-LS-12] Duplicate EmailAddr (same as MemberID 2001)
(2023, 'DupUser',  'Agarwal',    'rohan.agarwal@mail.com',    '+91-9700023432', '1991-03-10', 'M', 'Bronze',   '2024-01-01', 1, 'IN'),
-- [ANOMALY-LS-13] Future BirthDate
(2024, 'TimeAgent','Futura',     'time.agent@mail.com',       '+91-9700024542', '2099-05-05', 'M', 'Bronze',   '2024-02-01', 1, 'IN'),
-- [ANOMALY-LS-14] Invalid GenderCode
(2025, 'Pat',      'Nanda',      'pat.nanda@mail.com',        '+91-9700025652', '1993-07-11', 'Z', 'Bronze',   '2023-09-10', 1, 'IN'),
-- [ANOMALY-LS-15] Invalid MembershipLevel
(2026, 'Geeta',    'Rajan',      'geeta.rajan@mail.com',      '+91-9700026762', '1996-02-28', 'F', 'Titanium', '2023-10-20', 1, 'IN'),
-- [ANOMALY-LS-16] NULL CountryISO
(2027, 'Hetal',    'Parikh',     'hetal.parikh@mail.com',     '+91-9700027872', '1988-09-15', 'F', 'Bronze',   '2023-11-01', 1,  NULL);
GO

-- ============================================================
-- TABLE: Deals
-- Mirrors: RetailMart.Promotions
-- Differences: DealID, CouponCode, DealDesc, DiscType, DiscAmount,
--              MinCartValue, ValidFrom, ValidTo, IsLive
-- ============================================================
CREATE TABLE Deals (
    DealID       INT           NOT NULL PRIMARY KEY,
    CouponCode   VARCHAR(50)   NOT NULL UNIQUE,
    DealDesc     VARCHAR(255)  NULL,
    DiscType     VARCHAR(20)   NOT NULL,   -- PERCENT / FIXED
    DiscAmount   DECIMAL(10,2) NOT NULL,
    MinCartValue DECIMAL(10,2) NULL,
    ValidFrom    DATE          NOT NULL,
    ValidTo      DATE          NOT NULL,
    IsLive       BIT           NOT NULL DEFAULT 1,
    UpdatedTs    DATETIME      NOT NULL DEFAULT GETDATE()
);

INSERT INTO Deals (DealID, CouponCode, DealDesc, DiscType, DiscAmount, MinCartValue, ValidFrom, ValidTo, IsLive) VALUES
(1, 'GET10',     '10% off your cart',             'PERCENT', 10.00,   400.00, '2024-01-01', '2024-03-31', 1),
(2, 'OFF150',    'INR 150 off on orders >800',    'FIXED',  150.00,   800.00, '2024-02-01', '2024-02-29', 1),
(3, 'FIRST5',    '5% off first purchase',         'PERCENT',  5.00,     0.00, '2023-01-01', '2025-12-31', 1),
(4, 'MONSOON20', '20% monsoon bonanza',           'PERCENT', 20.00,   600.00, '2024-07-01', '2024-09-30', 1),
(5, 'MEGA400',   'INR 400 off on orders >1500',   'FIXED',  400.00,  1500.00, '2024-01-01', '2024-12-31', 1),
-- [ANOMALY-LS-17] DiscAmount = 0
(6, 'NODEAL',    'Zero value deal',               'PERCENT',  0.00,     0.00, '2024-01-01', '2024-12-31', 1),
-- [ANOMALY-LS-18] ValidTo before ValidFrom
(7, 'BACKTIME',  'Time-reversed deal',            'FIXED',  200.00,   500.00, '2024-08-01', '2024-01-01', 1),
-- [ANOMALY-LS-19] PERCENT DiscAmount > 100
(8, 'MEGA999',   'Impossible percent discount',   'PERCENT',999.00,     0.00, '2024-01-01', '2024-12-31', 1);
GO

-- ============================================================
-- TABLE: SalesOrders
-- Mirrors: RetailMart.Orders
-- Differences: SOrderID, MemberID, OrderDt, OrderState, GrossAmt,
--              DiscAmt, TaxAmt, FreightAmt, NetAmt, DealID,
--              DelivAddr, DelivCity, DelivState, PostalCode,
--              DeletedFlag, CreatedTs, UpdatedTs
-- ============================================================
CREATE TABLE SalesOrders (
    SOrderID    INT           NOT NULL PRIMARY KEY,
    MemberID    INT           NOT NULL,   -- no FK enforced
    OrderDt     DATETIME      NOT NULL,
    OrderState  VARCHAR(30)   NOT NULL,   -- no CHECK: invalid values are anomalies
    GrossAmt    DECIMAL(10,2) NOT NULL,
    DiscAmt     DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    TaxAmt      DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    FreightAmt  DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    NetAmt      DECIMAL(10,2) NOT NULL,
    DealID      INT           NULL,
    DelivAddr   VARCHAR(500)  NULL,
    DelivCity   VARCHAR(100)  NULL,
    DelivState  VARCHAR(100)  NULL,
    PostalCode  VARCHAR(10)   NULL,
    DeletedFlag BIT           NOT NULL DEFAULT 0,
    CreatedTs   DATETIME      NOT NULL DEFAULT GETDATE(),
    UpdatedTs   DATETIME      NOT NULL DEFAULT GETDATE()
);

-- ---- Bulk seed: 4000 clean sales orders ----
WITH OrderBase AS (
    SELECT TOP 4000
        ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS RowNum
    FROM sys.all_columns a CROSS JOIN sys.all_columns b
)
INSERT INTO SalesOrders (SOrderID, MemberID, OrderDt, OrderState, GrossAmt, DiscAmt, TaxAmt, FreightAmt, NetAmt, DealID, DelivAddr, DelivCity, DelivState, PostalCode)
SELECT
    20000 + RowNum,
    2001  + ((RowNum - 1) % 20),
    DATEADD(DAY, ABS(CHECKSUM(NEWID())) % 880, '2022-01-01'),
    CASE ((RowNum - 1) % 10)
        WHEN 0 THEN 'Pending'
        WHEN 1 THEN 'Confirmed'
        WHEN 2 THEN 'Shipped'
        WHEN 3 THEN 'Shipped'
        WHEN 4 THEN 'Delivered'
        WHEN 5 THEN 'Delivered'
        WHEN 6 THEN 'Delivered'
        WHEN 7 THEN 'Cancelled'
        WHEN 8 THEN 'Returned'
        ELSE       'Delivered'
    END,
    CAST(150  + (ABS(CHECKSUM(NEWID())) % 15000) AS DECIMAL(10,2)),
    CAST(       (ABS(CHECKSUM(NEWID())) % 400)   AS DECIMAL(10,2)),
    CAST(27   + (ABS(CHECKSUM(NEWID())) % 2700)  AS DECIMAL(10,2)),
    CAST(30   + (ABS(CHECKSUM(NEWID())) % 220)   AS DECIMAL(10,2)),
    CAST(200  + (ABS(CHECKSUM(NEWID())) % 15000) AS DECIMAL(10,2)),
    CASE WHEN (RowNum % 8) = 0 THEN (1 + (RowNum % 5)) ELSE NULL END,
    '456 Commerce Avenue',
    CASE (RowNum % 6) WHEN 0 THEN 'Mumbai'    WHEN 1 THEN 'Bengaluru'
                     WHEN 2 THEN 'Delhi'      WHEN 3 THEN 'Hyderabad'
                     WHEN 4 THEN 'Pune'       ELSE        'Kolkata' END,
    CASE (RowNum % 6) WHEN 0 THEN 'Maharashtra' WHEN 1 THEN 'Karnataka'
                     WHEN 2 THEN 'Delhi'        WHEN 3 THEN 'Telangana'
                     WHEN 4 THEN 'Maharashtra'  ELSE        'West Bengal' END,
    CAST(400001 + (RowNum % 99999) AS VARCHAR(10))
FROM OrderBase;
GO

-- ---- Anomaly orders ----
-- [ANOMALY-LS-20] Future OrderDt
INSERT INTO SalesOrders (SOrderID, MemberID, OrderDt, OrderState, GrossAmt, DiscAmt, TaxAmt, FreightAmt, NetAmt, DelivCity, DelivState, PostalCode)
VALUES (99201, 2001, '2099-03-01', 'Pending', 1200.00, 0.00, 216.00, 60.00, 1476.00, 'Mumbai', 'Maharashtra', '400001');

-- [ANOMALY-LS-21] Invalid OrderState
INSERT INTO SalesOrders (SOrderID, MemberID, OrderDt, OrderState, GrossAmt, DiscAmt, TaxAmt, FreightAmt, NetAmt, DelivCity, DelivState, PostalCode)
VALUES (99202, 2002, '2024-03-20', 'UNKNOWN_STATE', 900.00, 50.00, 162.00, 70.00, 1082.00, 'Delhi', 'Delhi', '110001');

-- [ANOMALY-LS-22] GrossAmt = 0
INSERT INTO SalesOrders (SOrderID, MemberID, OrderDt, OrderState, GrossAmt, DiscAmt, TaxAmt, FreightAmt, NetAmt, DelivCity, DelivState, PostalCode)
VALUES (99203, 2003, '2024-02-25', 'Confirmed', 0.00, 0.00, 0.00, 0.00, 0.00, 'Bengaluru', 'Karnataka', '560001');

-- [ANOMALY-LS-23] Negative GrossAmt
INSERT INTO SalesOrders (SOrderID, MemberID, OrderDt, OrderState, GrossAmt, DiscAmt, TaxAmt, FreightAmt, NetAmt, DelivCity, DelivState, PostalCode)
VALUES (99204, 2004, '2024-01-15', 'Delivered', -800.00, 0.00, 0.00, 60.00, -740.00, 'Chennai', 'Tamil Nadu', '600001');

-- [ANOMALY-LS-24] Ghost MemberID = 8888
INSERT INTO SalesOrders (SOrderID, MemberID, OrderDt, OrderState, GrossAmt, DiscAmt, TaxAmt, FreightAmt, NetAmt, DelivCity, DelivState, PostalCode)
VALUES (99205, 8888, '2024-04-01', 'Confirmed', 1500.00, 0.00, 270.00, 80.00, 1850.00, 'Hyderabad', 'Telangana', '500001');

-- [ANOMALY-LS-25] DiscAmt > GrossAmt
INSERT INTO SalesOrders (SOrderID, MemberID, OrderDt, OrderState, GrossAmt, DiscAmt, TaxAmt, FreightAmt, NetAmt, DelivCity, DelivState, PostalCode)
VALUES (99206, 2005, '2024-05-01', 'Pending', 400.00, 5000.00, 72.00, 60.00, -4588.00, 'Pune', 'Maharashtra', '411001');
GO

-- ============================================================
-- TABLE: SalesOrderLines
-- Mirrors: RetailMart.OrderItems
-- Differences: LineID, SOrderID, ProdID, Qty, SellingPrice,
--              LineTotalAmt, LineDisc, UpdatedTs
-- ============================================================
CREATE TABLE SalesOrderLines (
    LineID        INT            NOT NULL IDENTITY(1,1) PRIMARY KEY,
    SOrderID      INT            NOT NULL,   -- no FK enforced
    ProdID        INT            NOT NULL,   -- no FK enforced
    Qty           INT            NOT NULL,
    SellingPrice  DECIMAL(10,2)  NOT NULL,
    LineTotalAmt  DECIMAL(10,2)  NOT NULL,
    LineDisc      DECIMAL(10,2)  NOT NULL DEFAULT 0.00,
    UpdatedTs     DATETIME       NOT NULL DEFAULT GETDATE()
);

-- ---- Bulk seed: ~9000 line items ----
WITH LineBase AS (
    SELECT TOP 9000
        ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS RowNum
    FROM sys.all_columns a CROSS JOIN sys.all_columns b
)
INSERT INTO SalesOrderLines (SOrderID, ProdID, Qty, SellingPrice, LineTotalAmt, LineDisc)
SELECT
    20001 + ((RowNum - 1) % 3999),
    1     + ((RowNum - 1) % 20),
    1     + ((RowNum - 1) % 4),
    CAST(40   + (ABS(CHECKSUM(NEWID())) % 1460) AS DECIMAL(10,2)),
    CAST(40   + (ABS(CHECKSUM(NEWID())) % 5840) AS DECIMAL(10,2)),
    CAST(       (ABS(CHECKSUM(NEWID())) % 150)  AS DECIMAL(10,2))
FROM LineBase;
GO

-- ---- Anomaly line items ----
-- [ANOMALY-LS-26] Qty = 0
INSERT INTO SalesOrderLines (SOrderID, ProdID, Qty, SellingPrice, LineTotalAmt, LineDisc)
VALUES (20001, 1, 0, 699.00, 0.00, 0.00);

-- [ANOMALY-LS-27] Negative Qty
INSERT INTO SalesOrderLines (SOrderID, ProdID, Qty, SellingPrice, LineTotalAmt, LineDisc)
VALUES (20002, 2, -2, 349.00, -698.00, 0.00);

-- [ANOMALY-LS-28] LineTotalAmt mismatch: Qty(3) * SellingPrice(1499) = 4497, but LineTotalAmt = 50
INSERT INTO SalesOrderLines (SOrderID, ProdID, Qty, SellingPrice, LineTotalAmt, LineDisc)
VALUES (20003, 3, 3, 1499.00, 50.00, 0.00);

-- [ANOMALY-LS-29] SellingPrice = 0
INSERT INTO SalesOrderLines (SOrderID, ProdID, Qty, SellingPrice, LineTotalAmt, LineDisc)
VALUES (20004, 4, 1, 0.00, 0.00, 0.00);
GO

-- ============================================================
-- TABLE: Transactions
-- Mirrors: RetailMart.Payments
-- Differences: TxnID, SOrderID, TxnDt, PayMode, TxnStatus,
--              PaidAmt, TxnRef, PGName, UpdatedTs
-- ============================================================
CREATE TABLE Transactions (
    TxnID     INT            NOT NULL PRIMARY KEY,
    SOrderID  INT            NOT NULL,   -- no FK enforced
    TxnDt     DATETIME       NOT NULL,
    PayMode   VARCHAR(50)    NOT NULL,   -- UPI / Card / NetBanking / COD / Wallet / EMI
    TxnStatus VARCHAR(30)    NOT NULL,
    PaidAmt   DECIMAL(10,2)  NOT NULL,
    TxnRef    VARCHAR(100)   NULL,
    PGName    VARCHAR(50)    NULL,
    UpdatedTs DATETIME       NOT NULL DEFAULT GETDATE()
);

-- ---- Bulk seed: 3800 transactions ----
WITH TxnBase AS (
    SELECT TOP 3800
        ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS RowNum
    FROM sys.all_columns a CROSS JOIN sys.all_columns b
)
INSERT INTO Transactions (TxnID, SOrderID, TxnDt, PayMode, TxnStatus, PaidAmt, TxnRef, PGName)
SELECT
    40000 + RowNum,
    20000 + RowNum,
    DATEADD(MINUTE, ABS(CHECKSUM(NEWID())) % 1440,
            DATEADD(DAY, ABS(CHECKSUM(NEWID())) % 880, '2022-01-01')),
    CASE (RowNum % 6)
        WHEN 0 THEN 'UPI'         WHEN 1 THEN 'Card'
        WHEN 2 THEN 'NetBanking'  WHEN 3 THEN 'COD'
        WHEN 4 THEN 'Wallet'      ELSE        'EMI'
    END,
    CASE (RowNum % 10)
        WHEN 9 THEN 'Failed'   WHEN 8 THEN 'Pending'
        WHEN 7 THEN 'Refunded' ELSE       'Success'
    END,
    CAST(200 + (ABS(CHECKSUM(NEWID())) % 15000) AS DECIMAL(10,2)),
    'REF' + CAST(200000000 + RowNum AS VARCHAR(20)),
    CASE (RowNum % 3) WHEN 0 THEN 'CCAvenue' WHEN 1 THEN 'Cashfree' ELSE 'Stripe' END
FROM TxnBase;
GO

-- ---- Anomaly transactions ----
-- [ANOMALY-LS-30] Negative PaidAmt
INSERT INTO Transactions (TxnID, SOrderID, TxnDt, PayMode, TxnStatus, PaidAmt, TxnRef, PGName)
VALUES (99981, 20010, GETDATE(), 'UPI', 'Success', -300.00, 'REF-ERR-001', 'CCAvenue');

-- [ANOMALY-LS-31] PaidAmt = 0 with Success status
INSERT INTO Transactions (TxnID, SOrderID, TxnDt, PayMode, TxnStatus, PaidAmt, TxnRef, PGName)
VALUES (99982, 20011, GETDATE(), 'Card', 'Success', 0.00, 'REF-ERR-002', 'Cashfree');

-- [ANOMALY-LS-32] TxnDt before any plausible order date
INSERT INTO Transactions (TxnID, SOrderID, TxnDt, PayMode, TxnStatus, PaidAmt, TxnRef, PGName)
VALUES (99983, 20012, '2019-01-01', 'COD', 'Success', 650.00, 'REF-ERR-003', 'Stripe');

-- [ANOMALY-LS-33] Duplicate payment for same SOrderID
INSERT INTO Transactions (TxnID, SOrderID, TxnDt, PayMode, TxnStatus, PaidAmt, TxnRef, PGName)
VALUES (99984, 20001, GETDATE(), 'Wallet', 'Success', 800.00, 'REF-ERR-004', 'CCAvenue');
GO

-- ============================================================
-- TABLE: ProductReviews
-- Mirrors: RetailMart.Reviews
-- Differences: ReviewID, ProdID, MemberID, StarRating, ReviewBody,
--              ReviewDt, VerifiedPurchase, UsefulCount, UpdatedTs
-- ============================================================
CREATE TABLE ProductReviews (
    ReviewID          INT            NOT NULL PRIMARY KEY,
    ProdID            INT            NOT NULL,   -- no FK enforced
    MemberID          INT            NOT NULL,   -- no FK enforced
    StarRating        SMALLINT       NOT NULL,
    ReviewBody        VARCHAR(2000)  NULL,
    ReviewDt          DATETIME       NOT NULL,
    VerifiedPurchase  BIT            NOT NULL DEFAULT 0,
    UsefulCount       INT            NOT NULL DEFAULT 0,
    UpdatedTs         DATETIME       NOT NULL DEFAULT GETDATE()
);

-- ---- Bulk seed: 1800 reviews ----
WITH RevBase AS (
    SELECT TOP 1800
        ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS RowNum
    FROM sys.all_columns a CROSS JOIN sys.all_columns b
)
INSERT INTO ProductReviews (ReviewID, ProdID, MemberID, StarRating, ReviewBody, ReviewDt, VerifiedPurchase, UsefulCount)
SELECT
    60000 + RowNum,
    1    + ((RowNum - 1) % 20),
    2001 + ((RowNum - 1) % 20),
    1    + (ABS(CHECKSUM(NEWID())) % 5),
    CASE (RowNum % 4)
        WHEN 0 THEN 'Brilliant product, will buy again!'
        WHEN 1 THEN 'Good value for money.'
        WHEN 2 THEN 'Average, expected better quality.'
        ELSE        'Very happy with this purchase.'
    END,
    DATEADD(DAY, ABS(CHECKSUM(NEWID())) % 880, '2022-01-01'),
    CASE WHEN (RowNum % 3) = 0 THEN 1 ELSE 0 END,
    ABS(CHECKSUM(NEWID())) % 60
FROM RevBase;
GO

-- ---- Anomaly reviews ----
-- [ANOMALY-LS-34] StarRating = 0
INSERT INTO ProductReviews (ReviewID, ProdID, MemberID, StarRating, ReviewBody, ReviewDt, VerifiedPurchase)
VALUES (99851, 1, 2001, 0, 'Zero star data error', GETDATE(), 0);

-- [ANOMALY-LS-35] StarRating = 7 (above range)
INSERT INTO ProductReviews (ReviewID, ProdID, MemberID, StarRating, ReviewBody, ReviewDt, VerifiedPurchase)
VALUES (99852, 2, 2002, 7, 'Seven stars -- impossible', GETDATE(), 0);

-- [ANOMALY-LS-36] Ghost MemberID
INSERT INTO ProductReviews (ReviewID, ProdID, MemberID, StarRating, ReviewBody, ReviewDt, VerifiedPurchase)
VALUES (99853, 3, 8888, 3, 'Review from ghost member', GETDATE(), 0);

-- [ANOMALY-LS-37] Future ReviewDt
INSERT INTO ProductReviews (ReviewID, ProdID, MemberID, StarRating, ReviewBody, ReviewDt, VerifiedPurchase)
VALUES (99854, 4, 2004, 5, 'Review from the future', '2099-09-09', 1);
GO

-- ============================================================
-- LOGISTICS EXTENSION TABLES (LogiShip-only, no RM equivalent)
-- These pass through to Bronze without a UNION partner
-- ============================================================

CREATE TABLE Warehouses (
    WH_ID           INT           NOT NULL PRIMARY KEY,
    WH_Name         VARCHAR(150)  NOT NULL,
    WH_City         VARCHAR(100)  NOT NULL,
    WH_State        VARCHAR(100)  NOT NULL,
    CountryCode     CHAR(2)       NOT NULL DEFAULT 'IN',
    CapacityUnits   INT           NULL,
    IsOperational   BIT           NOT NULL DEFAULT 1,
    ManagerName     VARCHAR(100)  NULL,
    Phone           VARCHAR(20)   NULL,
    OpenedOn        DATE          NULL,
    UpdatedTs       DATETIME      NOT NULL DEFAULT GETDATE()
);

INSERT INTO Warehouses (WH_ID, WH_Name, WH_City, WH_State, CapacityUnits, IsOperational, ManagerName, Phone, OpenedOn) VALUES
(1, 'WH-Mumbai-Central',   'Mumbai',    'Maharashtra', 50000, 1, 'Rajesh Kamath',   '+91-9900001111', '2018-04-01'),
(2, 'WH-Bengaluru-Tech',   'Bengaluru', 'Karnataka',   40000, 1, 'Kavitha Murthy',  '+91-9900002222', '2019-06-15'),
(3, 'WH-Delhi-North',      'Delhi',     'Delhi',       60000, 1, 'Amit Srivastava', '+91-9900003333', '2017-01-10'),
(4, 'WH-Hyderabad-East',   'Hyderabad', 'Telangana',   35000, 1, 'Sridhar Reddy',   '+91-9900004444', '2020-08-20'),
(5, 'WH-Chennai-South',    'Chennai',   'Tamil Nadu',  45000, 1, 'Lakshmi Rajan',   '+91-9900005555', '2019-11-01'),
(6, 'WH-Pune-West',        'Pune',      'Maharashtra', 30000, 1, 'Suresh Jha',      '+91-9900006666', '2021-03-15'),
(7, 'WH-Kolkata-Port',     'Kolkata',   'West Bengal', 55000, 1, 'Piyali Sen',      '+91-9900007777', '2018-09-01'),
-- [ANOMALY-LS-38] CapacityUnits = 0
(8, 'WH-Ahmedabad-Ghost',  'Ahmedabad', 'Gujarat',         0, 1, NULL,              NULL,             '2023-01-01'),
-- [ANOMALY-LS-39] Future OpenedOn
(9, 'WH-Future-Hub',       'Surat',     'Gujarat',     25000, 1, 'TBD',             NULL,             '2099-01-01');
GO

CREATE TABLE Suppliers (
    SupID         INT           NOT NULL PRIMARY KEY,
    SupName       VARCHAR(200)  NOT NULL,
    SupEmail      VARCHAR(255)  NULL,
    SupPhone      VARCHAR(20)   NULL,
    CountryCode   CHAR(2)       NOT NULL DEFAULT 'IN',
    LeadDays      INT           NULL,
    PayTerms      VARCHAR(50)   NULL,
    SupRating     DECIMAL(3,1)  NULL,
    ActiveFlag    BIT           NOT NULL DEFAULT 1,
    OnboardDt     DATE          NULL,
    UpdatedTs     DATETIME      NOT NULL DEFAULT GETDATE()
);

INSERT INTO Suppliers (SupID, SupName, SupEmail, SupPhone, CountryCode, LeadDays, PayTerms, SupRating, ActiveFlag, OnboardDt) VALUES
(201, 'OnePlus India Dist',         'supply@oneplus.in',       '+91-80-11223344', 'IN',  7, 'Net15', 4.7, 1, '2020-01-01'),
(202, 'Xiaomi India Pvt Ltd',       'ops@xiaomi.in',           '+91-80-22334455', 'IN', 14, 'Net30', 4.5, 1, '2018-06-01'),
(203, 'Asus India Electronics',     'supply@asus.in',          '+91-80-33445566', 'IN', 21, 'Net45', 4.4, 1, '2019-03-01'),
(204, 'HP India Dist',              'hp.supply@hp.in',         '+91-22-44556677', 'IN', 14, 'Net30', 4.3, 1, '2017-08-01'),
(205, 'Myntra Brands Pvt Ltd',      'supply@myntra.in',        '+91-80-55667788', 'IN', 10, 'Net30', 4.2, 1, '2019-11-01'),
(206, 'Prestige Appliances',        'supply@prestige.in',      '+91-80-66778899', 'IN', 21, 'Net60', 4.5, 1, '2018-04-01'),
(207, 'iRobot APAC Dist',           'supply@irobot.in',        '+91-22-77889900', 'IN', 30, 'Net45', 4.6, 1, '2021-07-01'),
(208, 'Pepperfry Wholesale',        'ops@pepperfry.in',        '+91-22-88990011', 'IN', 45, 'Net60', 4.0, 1, '2020-03-01'),
(209, 'Decathlon India',            'supply@decathlon.in',     '+91-80-99001122', 'IN', 14, 'Net30', 4.7, 1, '2018-09-01'),
(210, 'HarperCollins India',        'supply@harpercollins.in', '+91-11-00112233', 'IN',  7, 'Net15', 4.5, 1, '2017-01-01'),
-- [ANOMALY-LS-40] NULL SupEmail
(211, 'Unknown Vendor X',           NULL,                      NULL,              'IN', 30, NULL,    NULL, 1, '2023-08-01'),
-- [ANOMALY-LS-41] SupRating > 5
(212, 'Super Vendor Ghost',         'ghost@sv.in',             '+91-11-11111111', 'IN', 10, 'Net30', 9.9, 1, '2023-01-01'),
-- [ANOMALY-LS-42] Negative LeadDays
(213, 'Zero-Day Supplier',          'zero@zd.in',              '+91-22-22222222', 'IN', -3, 'Net30', 4.0, 1, '2022-11-01');
GO

CREATE TABLE StockLedger (
    LedgerID      INT            NOT NULL IDENTITY(1,1) PRIMARY KEY,
    BarCode       VARCHAR(50)    NOT NULL,
    WH_ID         INT            NOT NULL,
    QtyOnHand     INT            NOT NULL DEFAULT 0,
    QtyReserved   INT            NOT NULL DEFAULT 0,
    QtyAvailable  AS (QtyOnHand - QtyReserved),
    ReorderLevel  INT            NOT NULL DEFAULT 50,
    ReplenishQty  INT            NOT NULL DEFAULT 200,
    LastStockDt   DATE           NULL,
    LastAuditDt   DATE           NULL,
    SupID         INT            NULL,
    UpdatedTs     DATETIME       NOT NULL DEFAULT GETDATE(),
    CONSTRAINT UQ_StockLedger_Bar_WH UNIQUE (BarCode, WH_ID)
);

INSERT INTO StockLedger (BarCode, WH_ID, QtyOnHand, QtyReserved, ReorderLevel, ReplenishQty, LastStockDt, LastAuditDt, SupID)
SELECT
    BC, WH,
    80  + (ABS(CHECKSUM(NEWID())) % 820),
    5   + (ABS(CHECKSUM(NEWID())) % 75),
    50, 200,
    DATEADD(DAY, -(ABS(CHECKSUM(NEWID())) % 90),  GETDATE()),
    DATEADD(DAY, -(ABS(CHECKSUM(NEWID())) % 30),  GETDATE()),
    201 + (ABS(CHECKSUM(NEWID())) % 10)
FROM (VALUES
    ('BAR-OP-12-5G-BLK'),('BAR-RD-N13P-BLU'),('BAR-AS-ROG-G16'),('BAR-HP-PAV15-SLV'),
    ('BAR-RS-SLM-32W'),  ('BAR-NK-RIR-M10'), ('BAR-HM-FWD-S'),  ('BAR-PR-IND-09'),
    ('BAR-IR-R-I3'),     ('BAR-PF-SOF-3ST'), ('BAR-DK-DB20-BLK'),('BAR-BK-RDPD'),
    ('BAR-BK-ALC-PC'),   ('BAR-BT-R450-BLU'),('BAR-SM-TABS9-GRY'),('BAR-MI-OL55'),
    ('BAR-BJ-OFX7'),     ('BAR-PM-CALI-W7'), ('BAR-KB-LIB2-WHT'),('BAR-DL-DED-EC685')
) AS S(BC)
CROSS JOIN (VALUES (1),(2),(3),(4),(5),(6),(7)) AS W(WH);
GO

-- [ANOMALY-LS-43] Negative QtyOnHand
INSERT INTO StockLedger (BarCode, WH_ID, QtyOnHand, QtyReserved, ReorderLevel, ReplenishQty, SupID)
VALUES ('BAR-OP-12-5G-BLK', 8, -180, 0, 50, 200, 201);

-- [ANOMALY-LS-44] QtyReserved > QtyOnHand
INSERT INTO StockLedger (BarCode, WH_ID, QtyOnHand, QtyReserved, ReorderLevel, ReplenishQty, SupID)
VALUES ('BAR-RD-N13P-BLU', 8, 5, 300, 50, 200, 202);

-- [ANOMALY-LS-45] Unknown BarCode (not in ProductCatalog)
INSERT INTO StockLedger (BarCode, WH_ID, QtyOnHand, QtyReserved, ReorderLevel, ReplenishQty, SupID)
VALUES ('BAR-PHANTOM-999', 1, 75, 0, 50, 200, 201);

-- [ANOMALY-LS-46] Ghost SupID
INSERT INTO StockLedger (BarCode, WH_ID, QtyOnHand, QtyReserved, ReorderLevel, ReplenishQty, SupID)
VALUES ('BAR-AS-ROG-G16', 8, 30, 2, 50, 200, 999);
GO

CREATE TABLE Shipments (
    ShipID          INT            NOT NULL PRIMARY KEY,
    SOrderID        INT            NOT NULL,
    WH_ID           INT            NOT NULL,
    DispatchDt      DATETIME       NULL,
    EstDelivDt      DATE           NULL,
    ActDelivDt      DATE           NULL,
    CourierCode     VARCHAR(20)    NULL,
    AWBNumber       VARCHAR(100)   NULL,
    ShipState       VARCHAR(30)    NOT NULL,
    FreightCharge   DECIMAL(10,2)  NOT NULL,
    ChargedWtKg     DECIMAL(8,3)   NULL,
    UpdatedTs       DATETIME       NOT NULL DEFAULT GETDATE()
);

WITH ShipBase AS (
    SELECT TOP 2500
        ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS RowNum
    FROM sys.all_columns a CROSS JOIN sys.all_columns b
)
INSERT INTO Shipments (ShipID, SOrderID, WH_ID, DispatchDt, EstDelivDt, ActDelivDt, CourierCode, AWBNumber, ShipState, FreightCharge, ChargedWtKg)
SELECT
    70000 + RowNum,
    20001 + ((RowNum - 1) % 2500),
    1     + ((RowNum - 1) % 7),
    DATEADD(DAY,  1 + ((RowNum - 1) % 880), '2022-01-01'),
    DATEADD(DAY,  4 + ((RowNum - 1) % 880), '2022-01-01'),
    CASE WHEN (RowNum % 10) < 8
         THEN DATEADD(DAY, 3 + ((RowNum - 1) % 880), '2022-01-01')
         ELSE NULL END,
    CASE (RowNum % 5)
        WHEN 0 THEN 'BLUEDART'  WHEN 1 THEN 'DELHIVERY'
        WHEN 2 THEN 'EKART'     WHEN 3 THEN 'SHADOWFAX'
        ELSE        'SMARTR'
    END,
    'AWB' + CAST(700000000 + RowNum AS VARCHAR(20)),
    CASE (RowNum % 6)
        WHEN 0 THEN 'Packed'           WHEN 1 THEN 'Dispatched'
        WHEN 2 THEN 'In Transit'       WHEN 3 THEN 'In Transit'
        WHEN 4 THEN 'Out for Delivery' ELSE        'Delivered'
    END,
    CAST(30 + (ABS(CHECKSUM(NEWID())) % 470) AS DECIMAL(10,2)),
    CAST(0.1 + (ABS(CHECKSUM(NEWID())) % 25) AS DECIMAL(8,3))
FROM ShipBase;
GO

-- [ANOMALY-LS-47] ActDelivDt before DispatchDt
INSERT INTO Shipments (ShipID, SOrderID, WH_ID, DispatchDt, EstDelivDt, ActDelivDt, CourierCode, AWBNumber, ShipState, FreightCharge)
VALUES (99301, 20060, 1, '2024-04-10', '2024-04-15', '2024-04-05', 'BLUEDART', 'AWB-ERR-001', 'Delivered', 100.00);

-- [ANOMALY-LS-48] Future DispatchDt
INSERT INTO Shipments (ShipID, SOrderID, WH_ID, DispatchDt, EstDelivDt, ActDelivDt, CourierCode, AWBNumber, ShipState, FreightCharge)
VALUES (99302, 20061, 2, '2099-07-01', '2099-07-05', NULL, 'DELHIVERY', 'AWB-ERR-002', 'Packed', 70.00);

-- [ANOMALY-LS-49] NULL CourierCode with Dispatched status
INSERT INTO Shipments (ShipID, SOrderID, WH_ID, DispatchDt, EstDelivDt, ActDelivDt, CourierCode, AWBNumber, ShipState, FreightCharge)
VALUES (99303, 20062, 3, '2024-03-01', '2024-03-06', NULL, NULL, NULL, 'Dispatched', 85.00);

-- [ANOMALY-LS-50] Negative FreightCharge
INSERT INTO Shipments (ShipID, SOrderID, WH_ID, DispatchDt, EstDelivDt, ActDelivDt, CourierCode, AWBNumber, ShipState, FreightCharge)
VALUES (99304, 20063, 4, '2024-02-10', '2024-02-15', '2024-02-14', 'EKART', 'AWB-ERR-004', 'Delivered', -40.00);
GO

CREATE TABLE Returns (
    RetID         INT            NOT NULL PRIMARY KEY,
    SOrderID      INT            NOT NULL,
    ShipID        INT            NULL,
    ReturnDt      DATETIME       NOT NULL,
    ReturnReason  VARCHAR(100)   NOT NULL,
    RetStatus     VARCHAR(30)    NOT NULL,
    RefundAmt     DECIMAL(10,2)  NULL,
    ReturnedBarCode VARCHAR(50)  NULL,
    RetQty        INT            NOT NULL DEFAULT 1,
    QCNotes       VARCHAR(500)   NULL,
    UpdatedTs     DATETIME       NOT NULL DEFAULT GETDATE()
);

WITH RetBase AS (
    SELECT TOP 600
        ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS RowNum
    FROM sys.all_columns a CROSS JOIN sys.all_columns b
)
INSERT INTO Returns (RetID, SOrderID, ShipID, ReturnDt, ReturnReason, RetStatus, RefundAmt, ReturnedBarCode, RetQty)
SELECT
    80000 + RowNum,
    20001 + ((RowNum - 1) % 600),
    70001 + ((RowNum - 1) % 600),
    DATEADD(DAY, 5 + (ABS(CHECKSUM(NEWID())) % 25),
            DATEADD(DAY, (RowNum - 1) % 880, '2022-01-01')),
    CASE (RowNum % 5)
        WHEN 0 THEN 'Defective'   WHEN 1 THEN 'Wrong Item'
        WHEN 2 THEN 'Not as Described' WHEN 3 THEN 'Changed Mind'
        ELSE        'Damaged in Transit'
    END,
    CASE (RowNum % 4)
        WHEN 0 THEN 'Requested' WHEN 1 THEN 'Approved'
        WHEN 2 THEN 'Received'  ELSE        'Refunded'
    END,
    CAST(150 + (ABS(CHECKSUM(NEWID())) % 1350) AS DECIMAL(10,2)),
    CASE ((RowNum-1) % 20)
        WHEN 0  THEN 'BAR-OP-12-5G-BLK'    WHEN 1  THEN 'BAR-RD-N13P-BLU'
        WHEN 2  THEN 'BAR-AS-ROG-G16'      WHEN 3  THEN 'BAR-HP-PAV15-SLV'
        WHEN 4  THEN 'BAR-RS-SLM-32W'      WHEN 5  THEN 'BAR-NK-RIR-M10'
        WHEN 6  THEN 'BAR-HM-FWD-S'        WHEN 7  THEN 'BAR-PR-IND-09'
        WHEN 8  THEN 'BAR-IR-R-I3'         WHEN 9  THEN 'BAR-PF-SOF-3ST'
        WHEN 10 THEN 'BAR-DK-DB20-BLK'     WHEN 11 THEN 'BAR-BK-RDPD'
        WHEN 12 THEN 'BAR-BK-ALC-PC'       WHEN 13 THEN 'BAR-BT-R450-BLU'
        WHEN 14 THEN 'BAR-SM-TABS9-GRY'    WHEN 15 THEN 'BAR-MI-OL55'
        WHEN 16 THEN 'BAR-BJ-OFX7'         WHEN 17 THEN 'BAR-PM-CALI-W7'
        WHEN 18 THEN 'BAR-KB-LIB2-WHT'     ELSE        'BAR-DL-DED-EC685'
    END,
    1 + (ABS(CHECKSUM(NEWID())) % 3)
FROM RetBase;
GO

-- [ANOMALY-LS-51] Orphaned return (NULL ShipID)
INSERT INTO Returns (RetID, SOrderID, ShipID, ReturnDt, ReturnReason, RetStatus, RefundAmt, ReturnedBarCode, RetQty)
VALUES (99701, 20090, NULL, '2024-05-01', 'Defective', 'Refunded', 699.00, 'BAR-OP-12-5G-BLK', 1);

-- [ANOMALY-LS-52] Negative RefundAmt
INSERT INTO Returns (RetID, SOrderID, ShipID, ReturnDt, ReturnReason, RetStatus, RefundAmt, ReturnedBarCode, RetQty)
VALUES (99702, 20091, 70092, '2024-03-10', 'Wrong Item', 'Refunded', -400.00, 'BAR-RD-N13P-BLU', 1);

-- [ANOMALY-LS-53] RetQty = 0
INSERT INTO Returns (RetID, SOrderID, ShipID, ReturnDt, ReturnReason, RetStatus, RefundAmt, ReturnedBarCode, RetQty)
VALUES (99703, 20092, 70093, '2024-02-20', 'Changed Mind', 'Requested', 59.99, 'BAR-RS-SLM-32W', 0);

-- [ANOMALY-LS-54] ReturnDt before any plausible DispatchDt
INSERT INTO Returns (RetID, SOrderID, ShipID, ReturnDt, ReturnReason, RetStatus, RefundAmt, ReturnedBarCode, RetQty)
VALUES (99704, 20093, 70094, '2019-06-01', 'Other', 'Approved', 299.00, 'BAR-BT-R450-BLU', 1);

-- [ANOMALY-LS-55] Unknown BarCode in return
INSERT INTO Returns (RetID, SOrderID, ShipID, ReturnDt, ReturnReason, RetStatus, RefundAmt, ReturnedBarCode, RetQty)
VALUES (99705, 20094, 70095, '2024-06-01', 'Defective', 'Received', 89.99, 'BAR-DOES-NOT-EXIST', 1);
GO

CREATE TABLE ProcurementOrders (
    POID        INT            NOT NULL PRIMARY KEY,
    SupID       INT            NOT NULL,
    WH_ID       INT            NOT NULL,
    PODt        DATE           NOT NULL,
    ExpArrDt    DATE           NULL,
    ActArrDt    DATE           NULL,
    POState     VARCHAR(30)    NOT NULL,
    OrderValue  DECIMAL(12,2)  NOT NULL,
    CurrencyCode CHAR(3)       NOT NULL DEFAULT 'INR',
    CreatedBy   VARCHAR(100)   NULL,
    UpdatedTs   DATETIME       NOT NULL DEFAULT GETDATE()
);

WITH POBase AS (
    SELECT TOP 400
        ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS RowNum
    FROM sys.all_columns a CROSS JOIN sys.all_columns b
)
INSERT INTO ProcurementOrders (POID, SupID, WH_ID, PODt, ExpArrDt, ActArrDt, POState, OrderValue, CurrencyCode, CreatedBy)
SELECT
    90000 + RowNum,
    201   + ((RowNum - 1) % 10),
    1     + ((RowNum - 1) % 7),
    DATEADD(DAY, -((RowNum - 1) % 700), GETDATE()),
    DATEADD(DAY, -((RowNum - 1) % 700) + 14, GETDATE()),
    CASE WHEN (RowNum % 5) < 4
         THEN DATEADD(DAY, -((RowNum - 1) % 700) + 16, GETDATE())
         ELSE NULL END,
    CASE (RowNum % 5)
        WHEN 0 THEN 'Draft'     WHEN 1 THEN 'Submitted'
        WHEN 2 THEN 'Confirmed' WHEN 3 THEN 'Received'
        ELSE        'Received'
    END,
    CAST(30000 + (ABS(CHECKSUM(NEWID())) % 870000) AS DECIMAL(12,2)),
    'INR',
    CASE (RowNum % 3) WHEN 0 THEN 'proc.user1' WHEN 1 THEN 'proc.user2' ELSE 'proc.user3' END
FROM POBase;
GO

-- [ANOMALY-LS-56] ActArrDt before PODt
INSERT INTO ProcurementOrders (POID, SupID, WH_ID, PODt, ExpArrDt, ActArrDt, POState, OrderValue, CurrencyCode)
VALUES (99801, 201, 1, '2024-04-10', '2024-04-25', '2024-04-01', 'Received', 120000.00, 'INR');

-- [ANOMALY-LS-57] OrderValue = 0
INSERT INTO ProcurementOrders (POID, SupID, WH_ID, PODt, ExpArrDt, ActArrDt, POState, OrderValue, CurrencyCode)
VALUES (99802, 202, 2, '2024-03-01', '2024-03-15', NULL, 'Confirmed', 0.00, 'INR');

-- [ANOMALY-LS-58] Invalid CurrencyCode
INSERT INTO ProcurementOrders (POID, SupID, WH_ID, PODt, ExpArrDt, ActArrDt, POState, OrderValue, CurrencyCode)
VALUES (99803, 203, 3, '2024-02-01', '2024-02-16', '2024-02-18', 'Received', 55000.00, 'ABC');

-- [ANOMALY-LS-59] POState = Received but ActArrDt is NULL
INSERT INTO ProcurementOrders (POID, SupID, WH_ID, PODt, ExpArrDt, ActArrDt, POState, OrderValue, CurrencyCode)
VALUES (99804, 204, 4, '2024-04-01', '2024-04-16', NULL, 'Received', 38000.00, 'INR');
GO

-- ============================================================
-- Profiling helper view
-- ============================================================
CREATE VIEW vw_TableRowCounts AS
SELECT t.name AS TableName, p.rows AS RowCount, GETDATE() AS ProfiledAt
FROM sys.tables t
INNER JOIN sys.partitions p ON t.object_id = p.object_id AND p.index_id IN (0,1);
GO

PRINT '================================================';
PRINT 'SourceDB_LogiShip v2 created successfully.';
PRINT '8 core ecommerce tables (union pairs with RetailMart)';
PRINT '6 logistics extension tables (pass-through to Bronze)';
PRINT '59 anomalies seeded across 14 tables.';
PRINT '================================================';
GO
