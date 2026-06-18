-- ============================================================
--  01_RawDB_Setup.sql
--  Creates RawDB with two schemas (retailmart / logiship),
--  one staging table per source table, a watermark control
--  table, and a load-log table.
--
--  DESIGN RULES:
--    • Every column from the source is kept as-is (no rename,
--      no cast) — anomalies must survive into Raw intact.
--    • Three metadata columns are appended to every table:
--        Raw_SourceSystem   VARCHAR(30)  — 'RetailMart' | 'LogiShip'
--        Raw_IngestedAt     DATETIME     — GETDATE() at load time
--        Raw_BatchID        INT          — FK to RawLoadLog
--    • No constraints beyond PK (composite: source PK + BatchID)
--      so duplicate / ghost rows land without error.
--    • Watermark table tracks last successful high-watermark
--      per source + table for incremental loads.
-- ============================================================

USE master;
GO
IF EXISTS (SELECT 1 FROM sys.databases WHERE name = 'RawDB')
BEGIN
    ALTER DATABASE RawDB SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
    DROP DATABASE RawDB;
END
GO
CREATE DATABASE RawDB COLLATE SQL_Latin1_General_CP1_CI_AS;
GO
USE RawDB;
GO

CREATE SCHEMA retailmart;
GO
CREATE SCHEMA logiship;
GO

-- ============================================================
-- CONTROL TABLES  (dbo schema)
-- ============================================================

-- One row per pipeline run
CREATE TABLE dbo.RawLoadLog (
    BatchID         INT           IDENTITY(1,1) PRIMARY KEY,
    RunStartedAt    DATETIME      NOT NULL DEFAULT GETDATE(),
    RunFinishedAt   DATETIME      NULL,
    Status          VARCHAR(20)   NOT NULL DEFAULT 'Running',  -- Running/Success/Failed
    TriggeredBy     VARCHAR(100)  NULL,
    Notes           VARCHAR(500)  NULL
);
GO

-- High-watermark per source table (drives incremental)
CREATE TABLE dbo.RawWatermark (
    WatermarkID     INT           IDENTITY(1,1) PRIMARY KEY,
    SourceSystem    VARCHAR(30)   NOT NULL,
    TableName       VARCHAR(100)  NOT NULL,
    WatermarkColumn VARCHAR(100)  NOT NULL,
    LastLoadedValue DATETIME      NOT NULL DEFAULT '1900-01-01',
    UpdatedAt       DATETIME      NOT NULL DEFAULT GETDATE(),
    CONSTRAINT UQ_Watermark UNIQUE (SourceSystem, TableName)
);
GO

-- Seed watermark rows for every source table
INSERT INTO dbo.RawWatermark (SourceSystem, TableName, WatermarkColumn, LastLoadedValue) VALUES
-- RetailMart
('RetailMart', 'Categories',  'CreatedDate',    '1900-01-01'),
('RetailMart', 'Products',    'ModifiedDate',   '1900-01-01'),
('RetailMart', 'Customers',   'ModifiedDate',   '1900-01-01'),
('RetailMart', 'Promotions',  'StartDate',      '1900-01-01'),  -- full reload each run
('RetailMart', 'Orders',      'CreatedDate',    '1900-01-01'),
('RetailMart', 'OrderItems',  'OrderItemID',    '1900-01-01'),  -- no timestamp; use PK
('RetailMart', 'Payments',    'PaymentDate',    '1900-01-01'),
('RetailMart', 'Reviews',     'ReviewDate',     '1900-01-01'),
-- LogiShip
('LogiShip',   'ProductCategories',  'UpdatedTs', '1900-01-01'),
('LogiShip',   'ProductCatalog',     'UpdatedTs', '1900-01-01'),
('LogiShip',   'Members',            'UpdatedTs', '1900-01-01'),
('LogiShip',   'Deals',              'UpdatedTs', '1900-01-01'),
('LogiShip',   'SalesOrders',        'UpdatedTs', '1900-01-01'),
('LogiShip',   'SalesOrderLines',    'UpdatedTs', '1900-01-01'),
('LogiShip',   'Transactions',       'UpdatedTs', '1900-01-01'),
('LogiShip',   'ProductReviews',     'UpdatedTs', '1900-01-01'),
('LogiShip',   'Warehouses',         'UpdatedTs', '1900-01-01'),
('LogiShip',   'Shipments',          'UpdatedTs', '1900-01-01'),
('LogiShip',   'Returns',            'UpdatedTs', '1900-01-01'),
('LogiShip',   'Suppliers',          'UpdatedTs', '1900-01-01'),
('LogiShip',   'StockLedger',        'UpdatedTs', '1900-01-01'),
('LogiShip',   'ProcurementOrders',  'UpdatedTs', '1900-01-01');
GO

-- ============================================================
-- SCHEMA: retailmart  — one table per SourceDB_RetailMart table
-- ============================================================

CREATE TABLE retailmart.Categories (
    CategoryID        INT           NULL,
    CategoryName      VARCHAR(100)  NULL,
    ParentCategoryID  INT           NULL,
    IsActive          BIT           NULL,
    CreatedDate       DATETIME      NULL,
    -- metadata
    Raw_SourceSystem  VARCHAR(30)   NOT NULL DEFAULT 'RetailMart',
    Raw_IngestedAt    DATETIME      NOT NULL DEFAULT GETDATE(),
    Raw_BatchID       INT           NOT NULL
);
GO

CREATE TABLE retailmart.Products (
    ProductID     INT            NULL,
    ProductName   VARCHAR(255)   NULL,
    CategoryID    INT            NULL,
    SKU           VARCHAR(50)    NULL,
    BasePrice     DECIMAL(10,2)  NULL,
    CostPrice     DECIMAL(10,2)  NULL,
    StockQty      INT            NULL,
    Weight_kg     DECIMAL(8,3)   NULL,
    IsActive      BIT            NULL,
    LaunchDate    DATE           NULL,
    CreatedDate   DATETIME       NULL,
    ModifiedDate  DATETIME       NULL,
    Raw_SourceSystem VARCHAR(30) NOT NULL DEFAULT 'RetailMart',
    Raw_IngestedAt   DATETIME    NOT NULL DEFAULT GETDATE(),
    Raw_BatchID      INT         NOT NULL
);
GO

CREATE TABLE retailmart.Customers (
    CustomerID     INT           NULL,
    FirstName      VARCHAR(100)  NULL,
    LastName       VARCHAR(100)  NULL,
    Email          VARCHAR(255)  NULL,
    Phone          VARCHAR(20)   NULL,
    DateOfBirth    DATE          NULL,
    Gender         CHAR(1)       NULL,
    LoyaltyTier    VARCHAR(20)   NULL,
    RegisteredDate DATETIME      NULL,
    ModifiedDate   DATETIME      NULL,
    IsActive       BIT           NULL,
    CountryCode    CHAR(2)       NULL,
    Raw_SourceSystem VARCHAR(30) NOT NULL DEFAULT 'RetailMart',
    Raw_IngestedAt   DATETIME    NOT NULL DEFAULT GETDATE(),
    Raw_BatchID      INT         NOT NULL
);
GO

CREATE TABLE retailmart.Promotions (
    PromoID       INT            NULL,
    PromoCode     VARCHAR(50)    NULL,
    Description   VARCHAR(255)  NULL,
    DiscountType  VARCHAR(20)    NULL,
    DiscountValue DECIMAL(10,2)  NULL,
    MinOrderValue DECIMAL(10,2)  NULL,
    StartDate     DATE           NULL,
    EndDate       DATE           NULL,
    IsActive      BIT            NULL,
    Raw_SourceSystem VARCHAR(30) NOT NULL DEFAULT 'RetailMart',
    Raw_IngestedAt   DATETIME    NOT NULL DEFAULT GETDATE(),
    Raw_BatchID      INT         NOT NULL
);
GO

CREATE TABLE retailmart.Orders (
    OrderID         INT            NULL,
    CustomerID      INT            NULL,
    OrderDate       DATETIME       NULL,
    Status          VARCHAR(30)    NULL,
    TotalAmount     DECIMAL(10,2)  NULL,
    DiscountAmount  DECIMAL(10,2)  NULL,
    TaxAmount       DECIMAL(10,2)  NULL,
    ShippingAmount  DECIMAL(10,2)  NULL,
    NetPayable      DECIMAL(10,2)  NULL,
    PromoID         INT            NULL,
    ShippingAddress VARCHAR(500)   NULL,
    City            VARCHAR(100)   NULL,
    State           VARCHAR(100)   NULL,
    PinCode         VARCHAR(10)    NULL,
    IsDeleted       BIT            NULL,
    CreatedDate     DATETIME       NULL,
    Raw_SourceSystem VARCHAR(30)   NOT NULL DEFAULT 'RetailMart',
    Raw_IngestedAt   DATETIME      NOT NULL DEFAULT GETDATE(),
    Raw_BatchID      INT           NOT NULL
);
GO

CREATE TABLE retailmart.OrderItems (
    OrderItemID  INT            NULL,
    OrderID      INT            NULL,
    ProductID    INT            NULL,
    Quantity     INT            NULL,
    UnitPrice    DECIMAL(10,2)  NULL,
    LineTotal    DECIMAL(10,2)  NULL,
    Discount     DECIMAL(10,2)  NULL,
    Raw_SourceSystem VARCHAR(30) NOT NULL DEFAULT 'RetailMart',
    Raw_IngestedAt   DATETIME    NOT NULL DEFAULT GETDATE(),
    Raw_BatchID      INT         NOT NULL
);
GO

CREATE TABLE retailmart.Payments (
    PaymentID      INT            NULL,
    OrderID        INT            NULL,
    PaymentDate    DATETIME       NULL,
    PaymentMethod  VARCHAR(50)    NULL,
    PaymentStatus  VARCHAR(30)    NULL,
    AmountPaid     DECIMAL(10,2)  NULL,
    TransactionRef VARCHAR(100)   NULL,
    GatewayName    VARCHAR(50)    NULL,
    Raw_SourceSystem VARCHAR(30)  NOT NULL DEFAULT 'RetailMart',
    Raw_IngestedAt   DATETIME     NOT NULL DEFAULT GETDATE(),
    Raw_BatchID      INT          NOT NULL
);
GO

CREATE TABLE retailmart.Reviews (
    ReviewID        INT            NULL,
    ProductID       INT            NULL,
    CustomerID      INT            NULL,
    Rating          SMALLINT       NULL,
    ReviewText      VARCHAR(2000)  NULL,
    ReviewDate      DATETIME       NULL,
    IsVerifiedBuyer BIT            NULL,
    HelpfulVotes    INT            NULL,
    Raw_SourceSystem VARCHAR(30)   NOT NULL DEFAULT 'RetailMart',
    Raw_IngestedAt   DATETIME      NOT NULL DEFAULT GETDATE(),
    Raw_BatchID      INT           NOT NULL
);
GO

-- ============================================================
-- SCHEMA: logiship  — one table per SourceDB_LogiShip table
-- ============================================================

CREATE TABLE logiship.ProductCategories (
    CatID        INT           NULL,
    CatName      VARCHAR(100)  NULL,
    ParentCatID  INT           NULL,
    ActiveFlag   BIT           NULL,
    CreatedTs    DATETIME      NULL,
    UpdatedTs    DATETIME      NULL,
    Raw_SourceSystem VARCHAR(30) NOT NULL DEFAULT 'LogiShip',
    Raw_IngestedAt   DATETIME    NOT NULL DEFAULT GETDATE(),
    Raw_BatchID      INT         NOT NULL
);
GO

CREATE TABLE logiship.ProductCatalog (
    ProdID        INT            NULL,
    ProdTitle     VARCHAR(255)   NULL,
    CatID         INT            NULL,
    BarCode       VARCHAR(50)    NULL,
    ListPrice     DECIMAL(10,2)  NULL,
    PurchasePrice DECIMAL(10,2)  NULL,
    AvailableQty  INT            NULL,
    WeightGrams   DECIMAL(10,2)  NULL,
    ActiveFlag    BIT            NULL,
    ReleaseDt     DATE           NULL,
    CreatedTs     DATETIME       NULL,
    LastUpdatedTs DATETIME       NULL,
    Raw_SourceSystem VARCHAR(30) NOT NULL DEFAULT 'LogiShip',
    Raw_IngestedAt   DATETIME    NOT NULL DEFAULT GETDATE(),
    Raw_BatchID      INT         NOT NULL
);
GO

CREATE TABLE logiship.Members (
    MemberID         INT           NULL,
    GivenName        VARCHAR(100)  NULL,
    Surname          VARCHAR(100)  NULL,
    EmailAddr        VARCHAR(255)  NULL,
    MobileNo         VARCHAR(20)   NULL,
    BirthDate        DATE          NULL,
    GenderCode       CHAR(1)       NULL,
    MembershipLevel  VARCHAR(20)   NULL,
    JoinedDt         DATETIME      NULL,
    ActiveFlag       BIT           NULL,
    CountryISO       CHAR(2)       NULL,
    UpdatedTs        DATETIME      NULL,
    Raw_SourceSystem VARCHAR(30)   NOT NULL DEFAULT 'LogiShip',
    Raw_IngestedAt   DATETIME      NOT NULL DEFAULT GETDATE(),
    Raw_BatchID      INT           NOT NULL
);
GO

CREATE TABLE logiship.Deals (
    DealID       INT            NULL,
    CouponCode   VARCHAR(50)    NULL,
    DealDesc     VARCHAR(255)   NULL,
    DiscType     VARCHAR(20)    NULL,
    DiscAmount   DECIMAL(10,2)  NULL,
    MinCartValue DECIMAL(10,2)  NULL,
    ValidFrom    DATE           NULL,
    ValidTo      DATE           NULL,
    IsLive       BIT            NULL,
    UpdatedTs    DATETIME       NULL,
    Raw_SourceSystem VARCHAR(30) NOT NULL DEFAULT 'LogiShip',
    Raw_IngestedAt   DATETIME    NOT NULL DEFAULT GETDATE(),
    Raw_BatchID      INT         NOT NULL
);
GO

CREATE TABLE logiship.SalesOrders (
    SOrderID    INT            NULL,
    MemberID    INT            NULL,
    OrderDt     DATETIME       NULL,
    OrderState  VARCHAR(30)    NULL,
    GrossAmt    DECIMAL(10,2)  NULL,
    DiscAmt     DECIMAL(10,2)  NULL,
    TaxAmt      DECIMAL(10,2)  NULL,
    FreightAmt  DECIMAL(10,2)  NULL,
    NetAmt      DECIMAL(10,2)  NULL,
    DealID      INT            NULL,
    DelivAddr   VARCHAR(500)   NULL,
    DelivCity   VARCHAR(100)   NULL,
    DelivState  VARCHAR(100)   NULL,
    PostalCode  VARCHAR(10)    NULL,
    DeletedFlag BIT            NULL,
    CreatedTs   DATETIME       NULL,
    UpdatedTs   DATETIME       NULL,
    Raw_SourceSystem VARCHAR(30) NOT NULL DEFAULT 'LogiShip',
    Raw_IngestedAt   DATETIME    NOT NULL DEFAULT GETDATE(),
    Raw_BatchID      INT         NOT NULL
);
GO

CREATE TABLE logiship.SalesOrderLines (
    LineID        INT            NULL,
    SOrderID      INT            NULL,
    ProdID        INT            NULL,
    Qty           INT            NULL,
    SellingPrice  DECIMAL(10,2)  NULL,
    LineTotalAmt  DECIMAL(10,2)  NULL,
    LineDisc      DECIMAL(10,2)  NULL,
    UpdatedTs     DATETIME       NULL,
    Raw_SourceSystem VARCHAR(30) NOT NULL DEFAULT 'LogiShip',
    Raw_IngestedAt   DATETIME    NOT NULL DEFAULT GETDATE(),
    Raw_BatchID      INT         NOT NULL
);
GO

CREATE TABLE logiship.Transactions (
    TxnID     INT            NULL,
    SOrderID  INT            NULL,
    TxnDt     DATETIME       NULL,
    PayMode   VARCHAR(50)    NULL,
    TxnStatus VARCHAR(30)    NULL,
    PaidAmt   DECIMAL(10,2)  NULL,
    TxnRef    VARCHAR(100)   NULL,
    PGName    VARCHAR(50)    NULL,
    UpdatedTs DATETIME       NULL,
    Raw_SourceSystem VARCHAR(30) NOT NULL DEFAULT 'LogiShip',
    Raw_IngestedAt   DATETIME    NOT NULL DEFAULT GETDATE(),
    Raw_BatchID      INT         NOT NULL
);
GO

CREATE TABLE logiship.ProductReviews (
    ReviewID         INT            NULL,
    ProdID           INT            NULL,
    MemberID         INT            NULL,
    StarRating       SMALLINT       NULL,
    ReviewBody       VARCHAR(2000)  NULL,
    ReviewDt         DATETIME       NULL,
    VerifiedPurchase BIT            NULL,
    UsefulCount      INT            NULL,
    UpdatedTs        DATETIME       NULL,
    Raw_SourceSystem VARCHAR(30)    NOT NULL DEFAULT 'LogiShip',
    Raw_IngestedAt   DATETIME       NOT NULL DEFAULT GETDATE(),
    Raw_BatchID      INT            NOT NULL
);
GO

CREATE TABLE logiship.Warehouses (
    WH_ID         INT           NULL,
    WH_Name       VARCHAR(150)  NULL,
    WH_City       VARCHAR(100)  NULL,
    WH_State      VARCHAR(100)  NULL,
    CountryCode   CHAR(2)       NULL,
    CapacityUnits INT           NULL,
    IsOperational BIT           NULL,
    ManagerName   VARCHAR(100)  NULL,
    Phone         VARCHAR(20)   NULL,
    OpenedOn      DATE          NULL,
    UpdatedTs     DATETIME      NULL,
    Raw_SourceSystem VARCHAR(30) NOT NULL DEFAULT 'LogiShip',
    Raw_IngestedAt   DATETIME    NOT NULL DEFAULT GETDATE(),
    Raw_BatchID      INT         NOT NULL
);
GO

CREATE TABLE logiship.Suppliers (
    SupID       INT           NULL,
    SupName     VARCHAR(200)  NULL,
    SupEmail    VARCHAR(255)  NULL,
    SupPhone    VARCHAR(20)   NULL,
    CountryCode CHAR(2)       NULL,
    LeadDays    INT           NULL,
    PayTerms    VARCHAR(50)   NULL,
    SupRating   DECIMAL(3,1)  NULL,
    ActiveFlag  BIT           NULL,
    OnboardDt   DATE          NULL,
    UpdatedTs   DATETIME      NULL,
    Raw_SourceSystem VARCHAR(30) NOT NULL DEFAULT 'LogiShip',
    Raw_IngestedAt   DATETIME    NOT NULL DEFAULT GETDATE(),
    Raw_BatchID      INT         NOT NULL
);
GO

CREATE TABLE logiship.StockLedger (
    LedgerID     INT            NULL,
    BarCode      VARCHAR(50)    NULL,
    WH_ID        INT            NULL,
    QtyOnHand    INT            NULL,
    QtyReserved  INT            NULL,
    ReorderLevel INT            NULL,
    ReplenishQty INT            NULL,
    LastStockDt  DATE           NULL,
    LastAuditDt  DATE           NULL,
    SupID        INT            NULL,
    UpdatedTs    DATETIME       NULL,
    Raw_SourceSystem VARCHAR(30) NOT NULL DEFAULT 'LogiShip',
    Raw_IngestedAt   DATETIME    NOT NULL DEFAULT GETDATE(),
    Raw_BatchID      INT         NOT NULL
);
GO

CREATE TABLE logiship.Shipments (
    ShipID        INT            NULL,
    SOrderID      INT            NULL,
    WH_ID         INT            NULL,
    DispatchDt    DATETIME       NULL,
    EstDelivDt    DATE           NULL,
    ActDelivDt    DATE           NULL,
    CourierCode   VARCHAR(20)    NULL,
    AWBNumber     VARCHAR(100)   NULL,
    ShipState     VARCHAR(30)    NULL,
    FreightCharge DECIMAL(10,2)  NULL,
    ChargedWtKg   DECIMAL(8,3)   NULL,
    UpdatedTs     DATETIME       NULL,
    Raw_SourceSystem VARCHAR(30) NOT NULL DEFAULT 'LogiShip',
    Raw_IngestedAt   DATETIME    NOT NULL DEFAULT GETDATE(),
    Raw_BatchID      INT         NOT NULL
);
GO

CREATE TABLE logiship.Returns (
    RetID           INT            NULL,
    SOrderID        INT            NULL,
    ShipID          INT            NULL,
    ReturnDt        DATETIME       NULL,
    ReturnReason    VARCHAR(100)   NULL,
    RetStatus       VARCHAR(30)    NULL,
    RefundAmt       DECIMAL(10,2)  NULL,
    ReturnedBarCode VARCHAR(50)    NULL,
    RetQty          INT            NULL,
    QCNotes         VARCHAR(500)   NULL,
    UpdatedTs       DATETIME       NULL,
    Raw_SourceSystem VARCHAR(30)   NOT NULL DEFAULT 'LogiShip',
    Raw_IngestedAt   DATETIME      NOT NULL DEFAULT GETDATE(),
    Raw_BatchID      INT           NOT NULL
);
GO

CREATE TABLE logiship.ProcurementOrders (
    POID         INT            NULL,
    SupID        INT            NULL,
    WH_ID        INT            NULL,
    PODt         DATE           NULL,
    ExpArrDt     DATE           NULL,
    ActArrDt     DATE           NULL,
    POState      VARCHAR(30)    NULL,
    OrderValue   DECIMAL(12,2)  NULL,
    CurrencyCode CHAR(3)        NULL,
    CreatedBy    VARCHAR(100)   NULL,
    UpdatedTs    DATETIME       NULL,
    Raw_SourceSystem VARCHAR(30) NOT NULL DEFAULT 'LogiShip',
    Raw_IngestedAt   DATETIME    NOT NULL DEFAULT GETDATE(),
    Raw_BatchID      INT         NOT NULL
);
GO

PRINT 'RawDB created — schemas: retailmart, logiship. 16 staging tables ready.';
GO
