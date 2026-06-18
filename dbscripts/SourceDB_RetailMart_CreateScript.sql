-- ============================================================
--  SourceDB_RetailMart  |  AI Data Trust Project
--  E-Commerce Source #1 : Retail Orders, Products, Customers
--
--  DESIGN NOTE ON CONSTRAINTS:
--  Source operational DBs intentionally have NO enforced FK
--  constraints — this is realistic (most OLTP systems rely on
--  application-layer integrity). FKs are documented as comments
--  so the Silver-layer validation gates can detect violations.
--  NOT NULL is relaxed on columns where NULL is itself an anomaly
--  we want to detect (e.g. CategoryName, Email).
-- ============================================================

USE master;
GO

IF EXISTS (SELECT name FROM sys.databases WHERE name = N'SourceDB_RetailMart')
BEGIN
    ALTER DATABASE SourceDB_RetailMart SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
    DROP DATABASE SourceDB_RetailMart;
END
GO

CREATE DATABASE SourceDB_RetailMart
    COLLATE SQL_Latin1_General_CP1_CI_AS;
GO
USE SourceDB_RetailMart;
GO

-- ============================================================
-- TABLE: Categories
-- NULL CategoryName is intentional anomaly — column is nullable
-- ============================================================
CREATE TABLE Categories (
    CategoryID       INT           NOT NULL PRIMARY KEY,
    CategoryName     VARCHAR(100)  NULL,          -- nullable: NULL value is a seeded anomaly
    ParentCategoryID INT           NULL,           -- self-ref hierarchy; no FK enforced on source
    IsActive         BIT           NOT NULL DEFAULT 1,
    CreatedDate      DATETIME      NOT NULL DEFAULT GETDATE()
);

INSERT INTO Categories (CategoryID, CategoryName, ParentCategoryID, IsActive) VALUES
( 1, 'Electronics',        NULL, 1),
( 2, 'Smartphones',        1,    1),
( 3, 'Laptops',            1,    1),
( 4, 'Clothing',           NULL, 1),
( 5, 'Mens Clothing',      4,    1),
( 6, 'Womens Clothing',    4,    1),
( 7, 'Home & Kitchen',     NULL, 1),
( 8, 'Kitchen Appliances', 7,    1),
( 9, 'Furniture',          7,    1),
(10, 'Sports & Outdoors',  NULL, 1),
(11, 'Fitness Equipment',  10,   1),
(12, 'Books',              NULL, 1),
(13, 'Fiction',            12,   1),
(14, 'Non-Fiction',        12,   1),
-- [ANOMALY-01] ParentCategoryID=99 references a non-existent parent (orphan hierarchy node)
(15, 'Tablets',            99,   1),
-- [ANOMALY-02] NULL CategoryName — should be caught by Gate 1 nullability check
(16, NULL,                 1,    1),
-- [ANOMALY-03] Duplicate CategoryName 'Electronics' — caught by Gate 2 dedup check
(17, 'Electronics',        NULL, 1);
GO

-- ============================================================
-- TABLE: Products
-- CategoryID column is nullable so anomaly row with CategoryID=99
-- can be inserted without a live FK blocking it.
-- ============================================================
CREATE TABLE Products (
    ProductID    INT            NOT NULL PRIMARY KEY,
    ProductName  VARCHAR(255)   NOT NULL,
    CategoryID   INT            NULL,           -- nullable: no enforced FK on source DB
    SKU          VARCHAR(50)    NOT NULL UNIQUE,
    BasePrice    DECIMAL(10,2)  NOT NULL,
    CostPrice    DECIMAL(10,2)  NULL,
    StockQty     INT            NOT NULL DEFAULT 0,
    Weight_kg    DECIMAL(8,3)   NULL,
    IsActive     BIT            NOT NULL DEFAULT 1,
    LaunchDate   DATE           NULL,
    CreatedDate  DATETIME       NOT NULL DEFAULT GETDATE(),
    ModifiedDate DATETIME       NULL
    -- FK_Products_Categories: CategoryID -> Categories(CategoryID) [not enforced; validated in Silver]
);

INSERT INTO Products (ProductID, ProductName, CategoryID, SKU, BasePrice, CostPrice, StockQty, Weight_kg, IsActive, LaunchDate) VALUES
( 1, 'Samsung Galaxy S24',          2,  'SKU-SM-S24-BLK',     999.00,  620.00, 150,  0.167, 1, '2024-01-17'),
( 2, 'Apple iPhone 15 Pro',         2,  'SKU-AP-IP15P-TIT',  1199.00,  750.00, 200,  0.187, 1, '2023-09-22'),
( 3, 'Dell XPS 15 Laptop',          3,  'SKU-DL-XPS15-SLV',  1599.00,  980.00,  75,  1.860, 1, '2023-11-01'),
( 4, 'MacBook Pro 14"',             3,  'SKU-AP-MBP14-GRY',  1999.00, 1250.00,  90,  1.600, 1, '2023-10-24'),
( 5, 'Levis 501 Jeans Men',         5,  'SKU-LV-501-32W',      69.95,   28.00, 500,  0.700, 1, '2022-03-15'),
( 6, 'Adidas Ultraboost 23 Men',    5,  'SKU-AD-UB23-M10',    180.00,   75.00, 300,  0.500, 1, '2023-02-01'),
( 7, 'Zara Summer Dress',           6,  'SKU-ZR-SUM-DRS-M',    49.99,   15.00, 400,  0.250, 1, '2023-04-10'),
( 8, 'Instant Pot Duo 7-in-1',      8,  'SKU-IP-DUO-7Q',       99.95,   42.00, 250,  4.200, 1, '2021-06-01'),
( 9, 'Dyson V15 Detect Vacuum',     8,  'SKU-DY-V15-DET',     699.99,  350.00, 120,  2.140, 1, '2022-05-12'),
(10, 'IKEA KALLAX Shelf 2x4',       9,  'SKU-IK-KLX-24-WHT',   89.99,   30.00, 180, 28.000, 1, '2020-01-01'),
(11, 'Bowflex SelectTech 552',      11, 'SKU-BF-ST552',        429.00,  180.00,  80, 17.200, 1, '2021-09-01'),
(12, 'Atomic Habits',               13, 'SKU-BK-ATH-JC',        18.99,    5.00,1000,  0.300, 1, '2018-10-16'),
(13, 'Sapiens',                     14, 'SKU-BK-SAP-YH',        16.99,    4.50, 800,  0.350, 1, '2015-02-10'),
(14, 'Sony WH-1000XM5 Headphones',  1,  'SKU-SN-WH1000XM5',   349.99,  190.00, 160,  0.250, 1, '2022-05-20'),
(15, 'Google Pixel 8 Pro',          2,  'SKU-GG-PXL8P-OBD',   999.00,  600.00, 110,  0.213, 1, '2023-10-04'),
(16, 'LG OLED 55" TV C3',           1,  'SKU-LG-OL55-C3',    1299.99,  700.00,  50, 17.600, 1, '2023-03-01'),
(17, 'Philips Air Fryer XXL',        8,  'SKU-PH-AFXXL',       119.99,   48.00, 220,  4.700, 1, '2022-08-01'),
(18, 'Nike Air Max 270 Women',       6,  'SKU-NK-AM270-W8',    150.00,   60.00, 350,  0.450, 1, '2022-11-15'),
(19, 'Kindle Paperwhite 11th Gen',  1,  'SKU-AP-KNP11-BLK',   139.99,   65.00, 400,  0.205, 1, '2021-10-27'),
(20, 'Nespresso Vertuo Plus',        8,  'SKU-NS-VTP-GRY',     199.99,   80.00, 175,  4.100, 1, '2020-07-01'),
-- [ANOMALY-04] Negative BasePrice: should be caught by Gate 1 range check
(21, 'Mystery Product A',           1,  'SKU-ERR-001',          -9.99,   10.00,  50,  0.100, 1, '2024-01-01'),
-- [ANOMALY-05] BasePrice = 0: caught by Gate 1 range check
(22, 'Freebie Sample Kit',          4,  'SKU-ERR-002',           0.00,    2.00, 200,  0.050, 1, '2024-01-01'),
-- [ANOMALY-06] CostPrice > BasePrice (margin inversion): caught by Gate 4 business rule
(23, 'Loss Leader Gadget',          1,  'SKU-ERR-003',          29.99,  150.00, 100,  0.200, 1, '2024-01-01'),
-- [ANOMALY-07] Future LaunchDate: caught by Gate 1 date sanity
(24, 'Unreleased Drone Pro',        1,  'SKU-ERR-004',         899.00,  400.00,   0,  1.200, 1, '2099-12-31'),
-- [ANOMALY-08] Negative StockQty: caught by Gate 1 range check
(25, 'Phantom Inventory Widget',    1,  'SKU-ERR-005',          49.99,   20.00,-300,  0.100, 1, '2023-01-01'),
-- [ANOMALY-09] CategoryID=99 does not exist: caught by Gate 4 referential integrity
(26, 'Orphaned Product',           99,  'SKU-ERR-006',          59.99,   25.00,  10,  0.150, 1, '2023-06-01');
GO

-- ============================================================
-- TABLE: Customers
-- Email is nullable so NULL anomaly inserts without error.
-- Gender and LoyaltyTier have no CHECK constraints on source —
-- invalid domain values are seeded intentionally.
-- ============================================================
CREATE TABLE Customers (
    CustomerID     INT           NOT NULL PRIMARY KEY,
    FirstName      VARCHAR(100)  NOT NULL,
    LastName       VARCHAR(100)  NOT NULL,
    Email          VARCHAR(255)  NULL,           -- nullable: NULL is a seeded anomaly
    Phone          VARCHAR(20)   NULL,
    DateOfBirth    DATE          NULL,
    Gender         CHAR(1)       NULL,           -- no CHECK: invalid values are anomalies
    LoyaltyTier    VARCHAR(20)   NULL,           -- no CHECK: invalid values are anomalies
    RegisteredDate DATETIME      NOT NULL DEFAULT GETDATE(),
    ModifiedDate   DATETIME      NULL,           -- updated on any profile change; used for incremental load watermark
    IsActive       BIT           NOT NULL DEFAULT 1,
    CountryCode    CHAR(2)       NULL
);

INSERT INTO Customers
    (CustomerID, FirstName, LastName, Email, Phone, DateOfBirth, Gender, LoyaltyTier, RegisteredDate, IsActive, CountryCode)
VALUES
(1001, 'Aarav',   'Sharma',     'aarav.sharma@email.com',    '+91-9876543210', '1990-05-14', 'M', 'Gold',     '2019-03-12', 1, 'IN'),
(1002, 'Priya',   'Mehta',      'priya.mehta@gmail.com',     '+91-9871234567', '1985-11-22', 'F', 'Platinum', '2020-11-18', 1, 'IN'),
(1003, 'Rahul',   'Verma',      'rahul.verma@outlook.com',   '+91-8800123456', '1995-07-08', 'M', 'Silver',   '2021-01-05', 1, 'IN'),
(1004, 'Sneha',   'Iyer',       'sneha.iyer@yahoo.com',      '+91-7700234567', '1993-02-28', 'F', 'Bronze',   '2021-06-20', 1, 'IN'),
(1005, 'Vikram',  'Nair',       'vikram.nair@email.com',     '+91-9900345678', '1988-09-15', 'M', 'Gold',     '2020-08-10', 1, 'IN'),
(1006, 'Ananya',  'Gupta',      'ananya.gupta@email.com',    '+91-9811456789', '1997-12-03', 'F', 'Silver',   '2022-03-01', 1, 'IN'),
(1007, 'Suresh',  'Pillai',     'suresh.pillai@email.com',   '+91-9822567890', '1982-04-19', 'M', 'Platinum', '2018-07-22', 1, 'IN'),
(1008, 'Kavya',   'Reddy',      'kavya.reddy@email.com',     '+91-9833678901', '1999-08-27', 'F', 'Bronze',   '2023-01-15', 1, 'IN'),
(1009, 'Arjun',   'Singh',      'arjun.singh@email.com',     '+91-9844789012', '1991-06-11', 'M', 'Gold',     '2020-05-30', 1, 'IN'),
(1010, 'Divya',   'Krishnan',   'divya.krishnan@email.com',  '+91-9855890123', '1994-03-25', 'F', 'Silver',   '2021-09-14', 1, 'IN'),
(1011, 'Karan',   'Joshi',      'karan.joshi@email.com',     '+91-9866901234', '1987-01-08', 'M', 'Platinum', '2017-12-01', 1, 'IN'),
(1012, 'Meera',   'Bhat',       'meera.bhat@email.com',      '+91-9877012345', '1996-10-16', 'F', 'Bronze',   '2022-08-18', 1, 'IN'),
(1013, 'Nikhil',  'Kulkarni',   'nikhil.kulkarni@email.com', '+91-9888123456', '1989-07-30', 'M', 'Gold',     '2019-11-25', 1, 'IN'),
(1014, 'Pooja',   'Desai',      'pooja.desai@email.com',     '+91-9899234567', '1992-05-05', 'F', 'Silver',   '2021-04-08', 1, 'IN'),
(1015, 'Rajan',   'Patel',      'rajan.patel@email.com',     '+91-9810345678', '1984-08-22', 'M', 'Platinum', '2016-09-15', 1, 'IN'),
(1016, 'Suman',   'Das',        'suman.das@email.com',       '+91-9821456789', '1998-11-14', 'F', 'Bronze',   '2023-03-20', 1, 'IN'),
(1017, 'Tarun',   'Bose',       'tarun.bose@email.com',      '+91-9832567890', '1990-02-18', 'M', 'Silver',   '2021-07-12', 1, 'IN'),
(1018, 'Uma',     'Rao',        'uma.rao@email.com',         '+91-9843678901', '1995-04-06', 'F', 'Gold',     '2020-01-28', 1, 'IN'),
(1019, 'Varun',   'Saxena',     'varun.saxena@email.com',    '+91-9854789012', '1986-09-10', 'M', 'Silver',   '2021-10-05', 1, 'IN'),
(1020, 'Wini',    'Chakraborty','wini.chak@email.com',       '+91-9865890123', '1993-12-22', 'F', 'Bronze',   '2022-12-01', 1, 'IN'),
-- [ANOMALY-10] NULL Email: Gate 1 nullability check
(1021, 'Gaurav',  'Tiwari',     NULL,                        '+91-9870001234', '1991-03-14', 'M', 'Bronze',   '2023-05-01', 1, 'IN'),
-- [ANOMALY-11] Malformed Email (no @ symbol): Gate 3 pattern check
(1022, 'Harsha',  'Kapoor',     'not-an-email',              '+91-9881112345', '1988-07-25', 'F', 'Silver',   '2022-11-11', 1, 'IN'),
-- [ANOMALY-12] Duplicate Email (same as CustomerID 1001): Gate 2 dedup check
(1023, 'Clone',   'Sharma',     'aarav.sharma@email.com',    '+91-9892223456', '1990-05-14', 'M', 'Bronze',   '2024-01-01', 1, 'IN'),
-- [ANOMALY-13] Future DateOfBirth: Gate 1 date sanity
(1024, 'Future',  'Person',     'future.person@email.com',   '+91-9803334567', '2099-01-01', 'M', 'Bronze',   '2024-01-10', 1, 'IN'),
-- [ANOMALY-14] Invalid Gender='X' (valid domain: M/F/O): Gate 3 domain check
(1025, 'Alex',    'Kumar',      'alex.kumar@email.com',      '+91-9814445678', '1993-06-18', 'X', 'Bronze',   '2023-08-15', 1, 'IN'),
-- [ANOMALY-15] Invalid LoyaltyTier='Diamond' (valid: Bronze/Silver/Gold/Platinum): Gate 3 domain check
(1026, 'Bina',    'Lal',        'bina.lal@email.com',        '+91-9825556789', '1995-09-30', 'F', 'Diamond',  '2023-09-20', 1, 'IN'),
-- [ANOMALY-16] NULL CountryCode: Gate 1 nullability check
(1027, 'Chetan',  'Mishra',     'chetan.mishra@email.com',   '+91-9836667890', '1988-04-12', 'M', 'Bronze',   '2023-10-01', 1,  NULL);
GO

-- ============================================================
-- TABLE: Promotions
-- No CHECK constraints — invalid values are anomalies
-- ============================================================
CREATE TABLE Promotions (
    PromoID       INT           NOT NULL PRIMARY KEY,
    PromoCode     VARCHAR(50)   NOT NULL UNIQUE,
    Description   VARCHAR(255)  NULL,
    DiscountType  VARCHAR(20)   NOT NULL,
    DiscountValue DECIMAL(10,2) NOT NULL,
    MinOrderValue DECIMAL(10,2) NULL,
    StartDate     DATE          NOT NULL,
    EndDate       DATE          NOT NULL,
    IsActive      BIT           NOT NULL DEFAULT 1
);

INSERT INTO Promotions (PromoID, PromoCode, Description, DiscountType, DiscountValue, MinOrderValue, StartDate, EndDate, IsActive) VALUES
(1, 'SAVE10',    '10% off sitewide',              'PERCENT', 10.00,    500.00, '2024-01-01', '2024-03-31', 1),
(2, 'FLAT200',   'Flat INR 200 off',              'FIXED',  200.00,    999.00, '2024-02-01', '2024-02-28', 1),
(3, 'WELCOME5',  '5% off first order',            'PERCENT',  5.00,      0.00, '2023-01-01', '2025-12-31', 1),
(4, 'SUMMER15',  '15% summer sale',               'PERCENT', 15.00,    750.00, '2024-04-01', '2024-06-30', 1),
(5, 'BIGBUY500', 'INR 500 off orders over 2000',  'FIXED',  500.00,   2000.00, '2024-01-15', '2024-12-31', 1),
-- [ANOMALY-17] DiscountValue=0: Gate 1 range check
(6, 'ZERODEAL',  'Invalid zero-value promo',      'PERCENT',  0.00,      0.00, '2024-01-01', '2024-12-31', 1),
-- [ANOMALY-18] EndDate < StartDate (time-reversed): Gate 1 date logic
(7, 'BADDATE',   'Time-reversed promo',           'FIXED',  100.00,    500.00, '2024-06-01', '2024-01-01', 1),
-- [ANOMALY-19] PERCENT DiscountValue > 100: Gate 4 business rule
(8, 'TOOBIG',    'Over 100% discount',            'PERCENT',150.00,      0.00, '2024-01-01', '2024-12-31', 1);
GO

-- ============================================================
-- TABLE: Orders
-- No FK constraints enforced — ghost CustomerIDs are anomalies
-- ============================================================
CREATE TABLE Orders (
    OrderID         INT           NOT NULL PRIMARY KEY,
    CustomerID      INT           NOT NULL,   -- no FK: ghost IDs are seeded anomalies
    OrderDate       DATETIME      NOT NULL,
    Status          VARCHAR(30)   NOT NULL,
    TotalAmount     DECIMAL(10,2) NOT NULL,
    DiscountAmount  DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    TaxAmount       DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    ShippingAmount  DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    NetPayable      DECIMAL(10,2) NOT NULL,
    PromoID         INT           NULL,       -- no FK enforced on source
    ShippingAddress VARCHAR(500)  NULL,
    City            VARCHAR(100)  NULL,
    State           VARCHAR(100)  NULL,
    PinCode         VARCHAR(10)   NULL,
    IsDeleted       BIT           NOT NULL DEFAULT 0,
    CreatedDate     DATETIME      NOT NULL DEFAULT GETDATE()
    -- FK_Orders_Customers:  CustomerID -> Customers(CustomerID) [validated in Silver]
    -- FK_Orders_Promotions: PromoID    -> Promotions(PromoID)   [validated in Silver]
);

-- ---- Bulk seed: 5000 clean orders ----
WITH OrderBase AS (
    SELECT TOP 5000
        ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS RowNum
    FROM sys.all_columns a CROSS JOIN sys.all_columns b
)
INSERT INTO Orders
    (OrderID, CustomerID, OrderDate, Status, TotalAmount, DiscountAmount,
     TaxAmount, ShippingAmount, NetPayable, PromoID,
     ShippingAddress, City, State, PinCode)
SELECT
    10000 + RowNum,
    1001  + ((RowNum - 1) % 20),
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
    CAST(200  + (ABS(CHECKSUM(NEWID())) % 18000) AS DECIMAL(10,2)),
    CAST(       (ABS(CHECKSUM(NEWID())) % 500)   AS DECIMAL(10,2)),
    CAST(36   + (ABS(CHECKSUM(NEWID())) % 3240)  AS DECIMAL(10,2)),
    CAST(40   + (ABS(CHECKSUM(NEWID())) % 260)   AS DECIMAL(10,2)),
    CAST(250  + (ABS(CHECKSUM(NEWID())) % 18000) AS DECIMAL(10,2)),
    CASE WHEN (RowNum % 7) = 0 THEN (1 + (RowNum % 5)) ELSE NULL END,
    '123 Sample Street',
    CASE (RowNum % 5) WHEN 0 THEN 'Mumbai' WHEN 1 THEN 'Bengaluru'
                      WHEN 2 THEN 'Delhi'  WHEN 3 THEN 'Hyderabad' ELSE 'Chennai' END,
    CASE (RowNum % 5) WHEN 0 THEN 'Maharashtra' WHEN 1 THEN 'Karnataka'
                      WHEN 2 THEN 'Delhi'        WHEN 3 THEN 'Telangana' ELSE 'Tamil Nadu' END,
    CAST(400001 + (RowNum % 99999) AS VARCHAR(10))
FROM OrderBase;
GO

-- ---- Anomaly orders ----
-- [ANOMALY-20] Future OrderDate
INSERT INTO Orders (OrderID, CustomerID, OrderDate, Status, TotalAmount, DiscountAmount, TaxAmount, ShippingAmount, NetPayable, ShippingAddress, City, State, PinCode)
VALUES (99001, 1001, '2099-01-01', 'Pending', 1500.00, 0.00, 270.00, 80.00, 1850.00, '1 Future Rd', 'Mumbai', 'Maharashtra', '400001');

-- [ANOMALY-21] Invalid Status value
INSERT INTO Orders (OrderID, CustomerID, OrderDate, Status, TotalAmount, DiscountAmount, TaxAmount, ShippingAmount, NetPayable, ShippingAddress, City, State, PinCode)
VALUES (99002, 1002, '2024-03-15', 'MYSTERY_STATUS', 800.00, 50.00, 144.00, 60.00, 954.00, '2 Err Lane', 'Delhi', 'Delhi', '110001');

-- [ANOMALY-22] TotalAmount = 0
INSERT INTO Orders (OrderID, CustomerID, OrderDate, Status, TotalAmount, DiscountAmount, TaxAmount, ShippingAmount, NetPayable, ShippingAddress, City, State, PinCode)
VALUES (99003, 1003, '2024-02-20', 'Confirmed', 0.00, 0.00, 0.00, 0.00, 0.00, '3 Zero St', 'Chennai', 'Tamil Nadu', '600001');

-- [ANOMALY-23] Negative TotalAmount
INSERT INTO Orders (OrderID, CustomerID, OrderDate, Status, TotalAmount, DiscountAmount, TaxAmount, ShippingAmount, NetPayable, ShippingAddress, City, State, PinCode)
VALUES (99004, 1004, '2024-01-10', 'Delivered', -500.00, 0.00, 0.00, 60.00, -440.00, '4 Neg Ave', 'Hyderabad', 'Telangana', '500001');

-- [ANOMALY-24] Ghost CustomerID=9999 (no FK enforced — detected by Gate 4 referential check)
INSERT INTO Orders (OrderID, CustomerID, OrderDate, Status, TotalAmount, DiscountAmount, TaxAmount, ShippingAmount, NetPayable, ShippingAddress, City, State, PinCode)
VALUES (99005, 9999, '2024-03-01', 'Pending', 1200.00, 0.00, 216.00, 80.00, 1496.00, '5 Ghost Blvd', 'Bengaluru', 'Karnataka', '560001');

-- [ANOMALY-25] DiscountAmount > TotalAmount
INSERT INTO Orders (OrderID, CustomerID, OrderDate, Status, TotalAmount, DiscountAmount, TaxAmount, ShippingAmount, NetPayable, ShippingAddress, City, State, PinCode)
VALUES (99006, 1005, '2024-04-01', 'Confirmed', 500.00, 9999.00, 90.00, 60.00, -9549.00, '6 Disc Rd', 'Mumbai', 'Maharashtra', '400002');
GO

-- ============================================================
-- TABLE: OrderItems
-- No FK constraints enforced on source
-- ============================================================
CREATE TABLE OrderItems (
    OrderItemID INT            NOT NULL IDENTITY(1,1) PRIMARY KEY,
    OrderID     INT            NOT NULL,   -- no FK enforced on source
    ProductID   INT            NOT NULL,   -- no FK enforced on source
    Quantity    INT            NOT NULL,
    UnitPrice   DECIMAL(10,2)  NOT NULL,
    LineTotal   DECIMAL(10,2)  NOT NULL,
    Discount    DECIMAL(10,2)  NOT NULL DEFAULT 0.00
    -- FK_OrderItems_Orders:   OrderID   -> Orders(OrderID)     [validated in Silver]
    -- FK_OrderItems_Products: ProductID -> Products(ProductID) [validated in Silver]
);

-- ---- Bulk seed: ~12,000 line items ----
WITH ItemBase AS (
    SELECT TOP 12000
        ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS RowNum
    FROM sys.all_columns a CROSS JOIN sys.all_columns b
)
INSERT INTO OrderItems (OrderID, ProductID, Quantity, UnitPrice, LineTotal, Discount)
SELECT
    10001 + ((RowNum - 1) % 4999),
    1     + ((RowNum - 1) % 20),
    1     + ((RowNum - 1) % 5),
    CAST(50   + (ABS(CHECKSUM(NEWID())) % 1950) AS DECIMAL(10,2)),
    CAST(50   + (ABS(CHECKSUM(NEWID())) % 9750) AS DECIMAL(10,2)),
    CAST(       (ABS(CHECKSUM(NEWID())) % 200)  AS DECIMAL(10,2))
FROM ItemBase;
GO

-- ---- Anomaly line items ----
-- [ANOMALY-26] Quantity = 0
INSERT INTO OrderItems (OrderID, ProductID, Quantity, UnitPrice, LineTotal, Discount)
VALUES (10001, 1, 0, 999.00, 0.00, 0.00);

-- [ANOMALY-27] Negative Quantity
INSERT INTO OrderItems (OrderID, ProductID, Quantity, UnitPrice, LineTotal, Discount)
VALUES (10002, 2, -1, 1199.00, -1199.00, 0.00);

-- [ANOMALY-28] LineTotal mismatch: Qty(2) * UnitPrice(1599) = 3198, but LineTotal=100
INSERT INTO OrderItems (OrderID, ProductID, Quantity, UnitPrice, LineTotal, Discount)
VALUES (10003, 3, 2, 1599.00, 100.00, 0.00);

-- [ANOMALY-29] UnitPrice = 0
INSERT INTO OrderItems (OrderID, ProductID, Quantity, UnitPrice, LineTotal, Discount)
VALUES (10004, 4, 1, 0.00, 0.00, 0.00);

-- [ANOMALY-09b] ProductID=26 is the orphaned product (CategoryID=99) — cross-anomaly chain
INSERT INTO OrderItems (OrderID, ProductID, Quantity, UnitPrice, LineTotal, Discount)
VALUES (10005, 26, 1, 59.99, 59.99, 0.00);
GO

-- ============================================================
-- TABLE: Payments
-- ============================================================
CREATE TABLE Payments (
    PaymentID      INT            NOT NULL PRIMARY KEY,
    OrderID        INT            NOT NULL,   -- no FK enforced on source
    PaymentDate    DATETIME       NOT NULL,
    PaymentMethod  VARCHAR(50)    NOT NULL,
    PaymentStatus  VARCHAR(30)    NOT NULL,
    AmountPaid     DECIMAL(10,2)  NOT NULL,
    TransactionRef VARCHAR(100)   NULL,
    GatewayName    VARCHAR(50)    NULL
    -- FK_Payments_Orders: OrderID -> Orders(OrderID) [validated in Silver]
);

-- ---- Bulk seed: 4800 payments ----
WITH PayBase AS (
    SELECT TOP 4800
        ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS RowNum
    FROM sys.all_columns a CROSS JOIN sys.all_columns b
)
INSERT INTO Payments (PaymentID, OrderID, PaymentDate, PaymentMethod, PaymentStatus, AmountPaid, TransactionRef, GatewayName)
SELECT
    20000 + RowNum,
    10000 + RowNum,
    DATEADD(MINUTE, ABS(CHECKSUM(NEWID())) % 1440,
            DATEADD(DAY, ABS(CHECKSUM(NEWID())) % 880, '2022-01-01')),
    CASE (RowNum % 6)
        WHEN 0 THEN 'UPI'          WHEN 1 THEN 'Credit Card'
        WHEN 2 THEN 'Debit Card'   WHEN 3 THEN 'Net Banking'
        WHEN 4 THEN 'COD'          ELSE       'Wallet'
    END,
    CASE (RowNum % 10)
        WHEN 9 THEN 'Failed'   WHEN 8 THEN 'Pending'
        WHEN 7 THEN 'Refunded' ELSE       'Success'
    END,
    CAST(250 + (ABS(CHECKSUM(NEWID())) % 18000) AS DECIMAL(10,2)),
    'TXN' + CAST(100000000 + RowNum AS VARCHAR(20)),
    CASE (RowNum % 3) WHEN 0 THEN 'Razorpay' WHEN 1 THEN 'Paytm' ELSE 'PhonePe' END
FROM PayBase;
GO

-- ---- Anomaly payments ----
-- [ANOMALY-30] Negative AmountPaid
INSERT INTO Payments (PaymentID, OrderID, PaymentDate, PaymentMethod, PaymentStatus, AmountPaid, TransactionRef, GatewayName)
VALUES (99901, 10010, GETDATE(), 'UPI', 'Success', -500.00, 'TXN-ERR-001', 'Razorpay');

-- [ANOMALY-31] AmountPaid=0 with Success status — business rule violation
INSERT INTO Payments (PaymentID, OrderID, PaymentDate, PaymentMethod, PaymentStatus, AmountPaid, TransactionRef, GatewayName)
VALUES (99902, 10011, GETDATE(), 'Credit Card', 'Success', 0.00, 'TXN-ERR-002', 'Paytm');

-- [ANOMALY-32] PaymentDate before any valid OrderDate — temporal impossibility
INSERT INTO Payments (PaymentID, OrderID, PaymentDate, PaymentMethod, PaymentStatus, AmountPaid, TransactionRef, GatewayName)
VALUES (99903, 10012, '2020-01-01', 'COD', 'Success', 800.00, 'TXN-ERR-003', 'PhonePe');

-- [ANOMALY-33] Duplicate payment for OrderID 10001 (already has a payment from bulk seed)
INSERT INTO Payments (PaymentID, OrderID, PaymentDate, PaymentMethod, PaymentStatus, AmountPaid, TransactionRef, GatewayName)
VALUES (99904, 10001, GETDATE(), 'UPI', 'Success', 1000.00, 'TXN-ERR-004', 'Razorpay');
GO

-- ============================================================
-- TABLE: Reviews
-- No FK constraints enforced on source
-- Rating is SMALLINT (not TINYINT) so value=6 inserts cleanly
-- ============================================================
CREATE TABLE Reviews (
    ReviewID        INT            NOT NULL PRIMARY KEY,
    ProductID       INT            NOT NULL,   -- no FK enforced on source
    CustomerID      INT            NOT NULL,   -- no FK enforced on source
    Rating          SMALLINT       NOT NULL,   -- SMALLINT: anomalies 0 and 6 insert without overflow
    ReviewText      VARCHAR(2000)  NULL,
    ReviewDate      DATETIME       NOT NULL,
    IsVerifiedBuyer BIT            NOT NULL DEFAULT 0,
    HelpfulVotes    INT            NOT NULL DEFAULT 0
    -- FK_Reviews_Products:  ProductID  -> Products(ProductID)   [validated in Silver]
    -- FK_Reviews_Customers: CustomerID -> Customers(CustomerID) [validated in Silver]
);

-- ---- Bulk seed: 2000 reviews ----
WITH RevBase AS (
    SELECT TOP 2000
        ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS RowNum
    FROM sys.all_columns a CROSS JOIN sys.all_columns b
)
INSERT INTO Reviews (ReviewID, ProductID, CustomerID, Rating, ReviewText, ReviewDate, IsVerifiedBuyer, HelpfulVotes)
SELECT
    30000 + RowNum,
    1    + ((RowNum - 1) % 20),
    1001 + ((RowNum - 1) % 20),
    1    + (ABS(CHECKSUM(NEWID())) % 5),
    CASE (RowNum % 4)
        WHEN 0 THEN 'Great product, highly recommend!'
        WHEN 1 THEN 'Decent quality for the price.'
        WHEN 2 THEN 'Not what I expected, could be better.'
        ELSE        'Excellent! Fast delivery too.'
    END,
    DATEADD(DAY, ABS(CHECKSUM(NEWID())) % 880, '2022-01-01'),
    CASE WHEN (RowNum % 3) = 0 THEN 1 ELSE 0 END,
    ABS(CHECKSUM(NEWID())) % 50
FROM RevBase;
GO

-- ---- Anomaly reviews ----
-- [ANOMALY-34] Rating=0 (below valid range 1-5): Gate 1 range check
INSERT INTO Reviews (ReviewID, ProductID, CustomerID, Rating, ReviewText, ReviewDate, IsVerifiedBuyer)
VALUES (99801, 1, 1001, 0, 'Zero rating - data entry error', GETDATE(), 0);

-- [ANOMALY-35] Rating=6 (above valid range 1-5): Gate 1 range check
INSERT INTO Reviews (ReviewID, ProductID, CustomerID, Rating, ReviewText, ReviewDate, IsVerifiedBuyer)
VALUES (99802, 2, 1002, 6, 'Six star rating - system glitch', GETDATE(), 0);

-- [ANOMALY-36] Ghost CustomerID=9999: Gate 4 referential integrity check
INSERT INTO Reviews (ReviewID, ProductID, CustomerID, Rating, ReviewText, ReviewDate, IsVerifiedBuyer)
VALUES (99803, 3, 9999, 4, 'Review from a non-existent customer', GETDATE(), 0);

-- [ANOMALY-37] Future ReviewDate: Gate 1 date sanity
INSERT INTO Reviews (ReviewID, ProductID, CustomerID, Rating, ReviewText, ReviewDate, IsVerifiedBuyer)
VALUES (99804, 4, 1004, 5, 'Review from the future', '2099-06-01', 1);
GO

-- ============================================================
-- Profiling helper view
-- ============================================================
CREATE VIEW vw_TableRowCounts AS
SELECT
    t.name    AS TableName,
    p.rows    AS RowCount,
    GETDATE() AS ProfiledAt
FROM sys.tables t
INNER JOIN sys.partitions p ON t.object_id = p.object_id AND p.index_id IN (0, 1);
GO

PRINT '================================================';
PRINT 'SourceDB_RetailMart created successfully.';
PRINT 'Anomalies seeded: 37 across 7 tables.';
PRINT 'Run vw_TableRowCounts to verify row counts.';
PRINT '================================================';
GO
