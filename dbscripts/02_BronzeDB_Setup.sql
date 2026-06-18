-- ============================================================
--  02_BronzeDB_Setup.sql
--  Single schema, one unified table per business concept.
--  Each table is a UNION ALL of both source Raw tables with:
--    • Normalised column names (source aliases resolved)
--    • Standardised domain values (Status, Gender, etc.)
--    • Derived/computed columns added at Bronze level
--    • SourceSystem + SourceNativeID preserved for lineage
--    • Brz_LoadedAt, Brz_BatchID metadata appended
--    • No surrogate keys here — those are Silver's job
-- ============================================================

USE master;
GO
IF EXISTS (SELECT 1 FROM sys.databases WHERE name = 'BronzeDB')
BEGIN
    ALTER DATABASE BronzeDB SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
    DROP DATABASE BronzeDB;
END
GO
CREATE DATABASE BronzeDB COLLATE SQL_Latin1_General_CP1_CI_AS;
GO
USE BronzeDB;
GO

-- ============================================================
-- CONTROL TABLE
-- ============================================================
CREATE TABLE dbo.BrzLoadLog (
    BatchID        INT          IDENTITY(1,1) PRIMARY KEY,
    RawBatchID     INT          NOT NULL,
    RunStartedAt   DATETIME     NOT NULL DEFAULT GETDATE(),
    RunFinishedAt  DATETIME     NULL,
    Status         VARCHAR(20)  NOT NULL DEFAULT 'Running',
    Notes          VARCHAR(500) NULL
);
GO

-- ============================================================
-- br_categories
-- Union: retailmart.Categories + logiship.ProductCategories
-- Transforms: normalise IsActive/ActiveFlag -> IsActive BIT
-- ============================================================
CREATE TABLE dbo.br_categories (
    Brz_CategoryID    INT           IDENTITY(1,1) PRIMARY KEY,
    SourceSystem      VARCHAR(30)   NOT NULL,
    SourceCategoryID  INT           NULL,
    CategoryName      VARCHAR(100)  NULL,
    ParentCategoryID  INT           NULL,
    IsActive          BIT           NULL,
    Src_CreatedDate   DATETIME      NULL,
    Brz_LoadedAt      DATETIME      NOT NULL DEFAULT GETDATE(),
    Brz_BatchID       INT           NOT NULL
);
GO

-- ============================================================
-- br_products
-- Union: retailmart.Products + logiship.ProductCatalog
-- Transforms:
--   WeightGrams (LS) -> Weight_kg: WeightGrams / 1000
--   BarCode (LS) stored as SKU_Barcode alongside SKU (RM)
--   ListPrice -> BasePrice, PurchasePrice -> CostPrice
--   AvailableQty -> StockQty
-- ============================================================
CREATE TABLE dbo.br_products (
    Brz_ProductID    INT            IDENTITY(1,1) PRIMARY KEY,
    SourceSystem     VARCHAR(30)    NOT NULL,
    SourceProductID  INT            NULL,
    ProductName      VARCHAR(255)   NULL,
    SourceCategoryID INT            NULL,   -- raw source cat id; Silver resolves to CategorySK
    SKU_Barcode      VARCHAR(50)    NULL,   -- SKU from RM, BarCode from LS
    BasePrice        DECIMAL(10,2)  NULL,
    CostPrice        DECIMAL(10,2)  NULL,
    StockQty         INT            NULL,
    Weight_kg        DECIMAL(10,4)  NULL,   -- LS WeightGrams/1000; RM Weight_kg as-is
    IsActive         BIT            NULL,
    LaunchDate       DATE           NULL,
    Src_CreatedDate  DATETIME       NULL,
    Src_UpdatedDate  DATETIME       NULL,
    Brz_LoadedAt     DATETIME       NOT NULL DEFAULT GETDATE(),
    Brz_BatchID      INT            NOT NULL
);
GO

-- ============================================================
-- br_customers
-- Union: retailmart.Customers + logiship.Members
-- Transforms:
--   GivenName+Surname (LS) -> FirstName+LastName
--   EmailAddr -> Email, MobileNo -> Phone
--   BirthDate -> DateOfBirth, GenderCode -> Gender
--   MembershipLevel -> LoyaltyTier, JoinedDt -> RegisteredDate
--   ActiveFlag -> IsActive, CountryISO -> CountryCode
-- ============================================================
CREATE TABLE dbo.br_customers (
    Brz_CustomerID    INT           IDENTITY(1,1) PRIMARY KEY,
    SourceSystem      VARCHAR(30)   NOT NULL,
    SourceCustomerID  INT           NULL,
    FirstName         VARCHAR(100)  NULL,
    LastName          VARCHAR(100)  NULL,
    Email             VARCHAR(255)  NULL,
    Phone             VARCHAR(20)   NULL,
    DateOfBirth       DATE          NULL,
    Gender            CHAR(1)       NULL,
    LoyaltyTier       VARCHAR(20)   NULL,
    RegisteredDate    DATETIME      NULL,
    IsActive          BIT           NULL,
    CountryCode       CHAR(2)       NULL,
    Src_UpdatedDate   DATETIME      NULL,
    Brz_LoadedAt      DATETIME      NOT NULL DEFAULT GETDATE(),
    Brz_BatchID       INT           NOT NULL
);
GO

-- ============================================================
-- br_promotions
-- Union: retailmart.Promotions + logiship.Deals
-- Transforms:
--   CouponCode -> PromoCode, DealDesc -> Description
--   DiscType -> DiscountType, DiscAmount -> DiscountValue
--   MinCartValue -> MinOrderValue, ValidFrom/To -> StartDate/EndDate
--   IsLive -> IsActive
--   Derived: IsExpired BIT = CASE WHEN EndDate < GETDATE() THEN 1 ELSE 0 END
-- ============================================================
CREATE TABLE dbo.br_promotions (
    Brz_PromoID      INT            IDENTITY(1,1) PRIMARY KEY,
    SourceSystem     VARCHAR(30)    NOT NULL,
    SourcePromoID    INT            NULL,
    PromoCode        VARCHAR(50)    NULL,
    Description      VARCHAR(255)   NULL,
    DiscountType     VARCHAR(20)    NULL,   -- normalised to PERCENT / FIXED
    DiscountValue    DECIMAL(10,2)  NULL,
    MinOrderValue    DECIMAL(10,2)  NULL,
    StartDate        DATE           NULL,
    EndDate          DATE           NULL,
    IsActive         BIT            NULL,
    IsExpired        BIT            NULL,   -- derived: EndDate < today
    Src_UpdatedDate  DATETIME       NULL,
    Brz_LoadedAt     DATETIME       NOT NULL DEFAULT GETDATE(),
    Brz_BatchID      INT            NOT NULL
);
GO

-- ============================================================
-- br_orders
-- Union: retailmart.Orders + logiship.SalesOrders
-- Transforms:
--   SOrderID -> SourceOrderID, MemberID -> SourceCustomerID
--   OrderDt -> OrderDate, OrderState -> OrderStatus
--   GrossAmt -> GrossAmount, DiscAmt -> DiscountAmount
--   TaxAmt -> TaxAmount, FreightAmt -> ShippingAmount
--   NetAmt -> NetPayable, DealID -> SourcePromoID
--   DelivCity -> City, DelivState -> State, PostalCode -> PinCode
--   DeletedFlag -> IsDeleted, CreatedTs -> CreatedDate
--   Standardise OrderStatus values:
--     RM: Pending/Confirmed/Shipped/Delivered/Cancelled/Returned (kept)
--     LS: same domain — pass through
--     Both: any other value -> 'Unknown' (anomaly preserved in RawDB)
--   Derived: IsFulfilled BIT = CASE WHEN OrderStatus='Delivered' THEN 1 ELSE 0 END
-- ============================================================
CREATE TABLE dbo.br_orders (
    Brz_OrderID        INT            IDENTITY(1,1) PRIMARY KEY,
    SourceSystem       VARCHAR(30)    NOT NULL,
    SourceOrderID      INT            NULL,
    SourceCustomerID   INT            NULL,
    OrderDate          DATETIME       NULL,
    OrderStatus        VARCHAR(30)    NULL,   -- standardised
    GrossAmount        DECIMAL(10,2)  NULL,
    DiscountAmount     DECIMAL(10,2)  NULL,
    TaxAmount          DECIMAL(10,2)  NULL,
    ShippingAmount     DECIMAL(10,2)  NULL,
    NetPayable         DECIMAL(10,2)  NULL,
    SourcePromoID      INT            NULL,
    ShippingAddress    VARCHAR(500)   NULL,
    City               VARCHAR(100)   NULL,
    State              VARCHAR(100)   NULL,
    PinCode            VARCHAR(10)    NULL,
    IsDeleted          BIT            NULL,
    IsFulfilled        BIT            NULL,   -- derived
    Src_CreatedDate    DATETIME       NULL,
    Src_UpdatedDate    DATETIME       NULL,
    Brz_LoadedAt       DATETIME       NOT NULL DEFAULT GETDATE(),
    Brz_BatchID        INT            NOT NULL
);
GO

-- ============================================================
-- br_order_items
-- Union: retailmart.OrderItems + logiship.SalesOrderLines
-- Transforms:
--   LineID -> SourceLineID, SOrderID -> SourceOrderID
--   ProdID -> SourceProductID, Qty -> Quantity
--   SellingPrice -> UnitPrice, LineTotalAmt -> LineTotal
--   LineDisc -> Discount
--   Derived: LineTotalCalc = Quantity * UnitPrice (for validation flag)
--   Derived: LineDiscrepancy BIT = CASE WHEN ABS(LineTotal - Quantity*UnitPrice) > 0.01 THEN 1 ELSE 0 END
-- ============================================================
CREATE TABLE dbo.br_order_items (
    Brz_LineItemID     INT            IDENTITY(1,1) PRIMARY KEY,
    SourceSystem       VARCHAR(30)    NOT NULL,
    SourceLineItemID   INT            NULL,
    SourceOrderID      INT            NULL,
    SourceProductID    INT            NULL,
    Quantity           INT            NULL,
    UnitPrice          DECIMAL(10,2)  NULL,
    LineTotal          DECIMAL(10,2)  NULL,
    Discount           DECIMAL(10,2)  NULL,
    LineTotalCalc      DECIMAL(10,2)  NULL,   -- derived: Qty * UnitPrice
    LineDiscrepancy    BIT            NULL,   -- derived: calc vs stored mismatch flag
    Src_UpdatedDate    DATETIME       NULL,
    Brz_LoadedAt       DATETIME       NOT NULL DEFAULT GETDATE(),
    Brz_BatchID        INT            NOT NULL
);
GO

-- ============================================================
-- br_payments
-- Union: retailmart.Payments + logiship.Transactions
-- Transforms:
--   TxnID -> SourcePaymentID, SOrderID -> SourceOrderID
--   TxnDt -> PaymentDate, PayMode -> PaymentMethod
--   TxnStatus -> PaymentStatus, PaidAmt -> AmountPaid
--   TxnRef -> TransactionRef, PGName -> GatewayName
--   Normalise PaymentMethod: Card -> Credit Card (pass; Bronze keeps LS values distinct)
--   Normalise PaymentStatus to: Success/Failed/Pending/Refunded/Unknown
-- ============================================================
CREATE TABLE dbo.br_payments (
    Brz_PaymentID     INT            IDENTITY(1,1) PRIMARY KEY,
    SourceSystem      VARCHAR(30)    NOT NULL,
    SourcePaymentID   INT            NULL,
    SourceOrderID     INT            NULL,
    PaymentDate       DATETIME       NULL,
    PaymentMethod     VARCHAR(50)    NULL,
    PaymentStatus     VARCHAR(30)    NULL,   -- normalised
    AmountPaid        DECIMAL(10,2)  NULL,
    TransactionRef    VARCHAR(100)   NULL,
    GatewayName       VARCHAR(50)    NULL,
    Src_UpdatedDate   DATETIME       NULL,
    Brz_LoadedAt      DATETIME       NOT NULL DEFAULT GETDATE(),
    Brz_BatchID       INT            NOT NULL
);
GO

-- ============================================================
-- br_reviews
-- Union: retailmart.Reviews + logiship.ProductReviews
-- Transforms:
--   ProdID -> SourceProductID, MemberID -> SourceCustomerID
--   StarRating -> Rating, ReviewBody -> ReviewText
--   ReviewDt -> ReviewDate, VerifiedPurchase -> IsVerifiedBuyer
--   UsefulCount -> HelpfulVotes
-- ============================================================
CREATE TABLE dbo.br_reviews (
    Brz_ReviewID       INT            IDENTITY(1,1) PRIMARY KEY,
    SourceSystem       VARCHAR(30)    NOT NULL,
    SourceReviewID     INT            NULL,
    SourceProductID    INT            NULL,
    SourceCustomerID   INT            NULL,
    Rating             SMALLINT       NULL,
    ReviewText         VARCHAR(2000)  NULL,
    ReviewDate         DATETIME       NULL,
    IsVerifiedBuyer    BIT            NULL,
    HelpfulVotes       INT            NULL,
    Src_UpdatedDate    DATETIME       NULL,
    Brz_LoadedAt       DATETIME       NOT NULL DEFAULT GETDATE(),
    Brz_BatchID        INT            NOT NULL
);
GO

-- ============================================================
-- br_warehouses  (LogiShip only — no RM equivalent)
-- ============================================================
CREATE TABLE dbo.br_warehouses (
    Brz_WarehouseID   INT           IDENTITY(1,1) PRIMARY KEY,
    SourceSystem      VARCHAR(30)   NOT NULL DEFAULT 'LogiShip',
    SourceWarehouseID INT           NULL,
    WarehouseName     VARCHAR(150)  NULL,
    City              VARCHAR(100)  NULL,
    State             VARCHAR(100)  NULL,
    CountryCode       CHAR(2)       NULL,
    CapacityUnits     INT           NULL,
    IsOperational     BIT           NULL,
    ManagerName       VARCHAR(100)  NULL,
    Phone             VARCHAR(20)   NULL,
    OpenedOn          DATE          NULL,
    Src_UpdatedDate   DATETIME      NULL,
    Brz_LoadedAt      DATETIME      NOT NULL DEFAULT GETDATE(),
    Brz_BatchID       INT           NOT NULL
);
GO

-- ============================================================
-- br_suppliers  (LogiShip only)
-- ============================================================
CREATE TABLE dbo.br_suppliers (
    Brz_SupplierID    INT            IDENTITY(1,1) PRIMARY KEY,
    SourceSystem      VARCHAR(30)    NOT NULL DEFAULT 'LogiShip',
    SourceSupplierID  INT            NULL,
    SupplierName      VARCHAR(200)   NULL,
    Email             VARCHAR(255)   NULL,
    Phone             VARCHAR(20)    NULL,
    CountryCode       CHAR(2)        NULL,
    LeadDays          INT            NULL,
    PayTerms          VARCHAR(50)    NULL,
    Rating            DECIMAL(3,1)   NULL,
    IsActive          BIT            NULL,
    OnboardDate       DATE           NULL,
    Src_UpdatedDate   DATETIME       NULL,
    Brz_LoadedAt      DATETIME       NOT NULL DEFAULT GETDATE(),
    Brz_BatchID       INT            NOT NULL
);
GO

-- ============================================================
-- br_inventory  (LogiShip only)
-- Transforms: QtyAvailable computed column stored as physical INT
-- ============================================================
CREATE TABLE dbo.br_inventory (
    Brz_InventoryID   INT            IDENTITY(1,1) PRIMARY KEY,
    SourceSystem      VARCHAR(30)    NOT NULL DEFAULT 'LogiShip',
    SourceLedgerID    INT            NULL,
    BarCode           VARCHAR(50)    NULL,
    SourceWarehouseID INT            NULL,
    QtyOnHand         INT            NULL,
    QtyReserved       INT            NULL,
    QtyAvailable      INT            NULL,   -- stored physical (LS computed col materialised)
    ReorderLevel      INT            NULL,
    ReplenishQty      INT            NULL,
    SourceSupplierID  INT            NULL,
    LastStockDate     DATE           NULL,
    LastAuditDate     DATE           NULL,
    Src_UpdatedDate   DATETIME       NULL,
    Brz_LoadedAt      DATETIME       NOT NULL DEFAULT GETDATE(),
    Brz_BatchID       INT            NOT NULL
);
GO

-- ============================================================
-- br_shipments  (LogiShip only)
-- Transforms:
--   DispatchDt -> ShipmentDate, EstDelivDt -> ExpectedDelivery
--   ActDelivDt -> ActualDelivery, CourierCode -> CarrierCode
--   AWBNumber -> TrackingNumber, ShipState -> ShipmentStatus
--   FreightCharge -> ShippingCost
--   Derived: DeliveryDays INT = DATEDIFF(day, ShipmentDate, ActualDelivery)
--   Derived: IsLateDelivery BIT = CASE WHEN ActualDelivery > ExpectedDelivery THEN 1 ELSE 0 END
-- ============================================================
CREATE TABLE dbo.br_shipments (
    Brz_ShipmentID     INT            IDENTITY(1,1) PRIMARY KEY,
    SourceSystem       VARCHAR(30)    NOT NULL DEFAULT 'LogiShip',
    SourceShipmentID   INT            NULL,
    SourceOrderID      INT            NULL,
    SourceWarehouseID  INT            NULL,
    ShipmentDate       DATETIME       NULL,
    ExpectedDelivery   DATE           NULL,
    ActualDelivery     DATE           NULL,
    CarrierCode        VARCHAR(20)    NULL,
    TrackingNumber     VARCHAR(100)   NULL,
    ShipmentStatus     VARCHAR(30)    NULL,
    ShippingCost       DECIMAL(10,2)  NULL,
    ChargedWeightKg    DECIMAL(8,3)   NULL,
    DeliveryDays       INT            NULL,   -- derived
    IsLateDelivery     BIT            NULL,   -- derived
    Src_UpdatedDate    DATETIME       NULL,
    Brz_LoadedAt       DATETIME       NOT NULL DEFAULT GETDATE(),
    Brz_BatchID        INT            NOT NULL
);
GO

-- ============================================================
-- br_returns  (LogiShip only)
-- Transforms:
--   RetID -> SourceReturnID, ReturnReason -> Reason
--   RetStatus -> ReturnStatus, RefundAmt -> RefundAmount
--   ReturnedBarCode -> ReturnSKU, RetQty -> ReturnQty
--   Derived: IsRefunded BIT = CASE WHEN ReturnStatus='Refunded' THEN 1 ELSE 0 END
-- ============================================================
CREATE TABLE dbo.br_returns (
    Brz_ReturnID      INT            IDENTITY(1,1) PRIMARY KEY,
    SourceSystem      VARCHAR(30)    NOT NULL DEFAULT 'LogiShip',
    SourceReturnID    INT            NULL,
    SourceOrderID     INT            NULL,
    SourceShipmentID  INT            NULL,
    ReturnDate        DATETIME       NULL,
    Reason            VARCHAR(100)   NULL,
    ReturnStatus      VARCHAR(30)    NULL,
    RefundAmount      DECIMAL(10,2)  NULL,
    ReturnSKU         VARCHAR(50)    NULL,
    ReturnQty         INT            NULL,
    QCNotes           VARCHAR(500)   NULL,
    IsRefunded        BIT            NULL,   -- derived
    Src_UpdatedDate   DATETIME       NULL,
    Brz_LoadedAt      DATETIME       NOT NULL DEFAULT GETDATE(),
    Brz_BatchID       INT            NOT NULL
);
GO

-- ============================================================
-- br_procurement  (LogiShip only)
-- Transforms:
--   SupID -> SourceSupplierID, WH_ID -> SourceWarehouseID
--   PODt -> PODate, ExpArrDt -> ExpectedArrival
--   ActArrDt -> ActualArrival, POState -> POStatus
--   OrderValue -> TotalValue, CurrencyCode -> Currency
--   Derived: LeadTimeDays INT = DATEDIFF(day, PODate, ActualArrival)
--   Derived: IsDelayed BIT = CASE WHEN ActualArrival > ExpectedArrival THEN 1 ELSE 0 END
-- ============================================================
CREATE TABLE dbo.br_procurement (
    Brz_POID           INT            IDENTITY(1,1) PRIMARY KEY,
    SourceSystem       VARCHAR(30)    NOT NULL DEFAULT 'LogiShip',
    SourcePOID         INT            NULL,
    SourceSupplierID   INT            NULL,
    SourceWarehouseID  INT            NULL,
    PODate             DATE           NULL,
    ExpectedArrival    DATE           NULL,
    ActualArrival      DATE           NULL,
    POStatus           VARCHAR(30)    NULL,
    TotalValue         DECIMAL(12,2)  NULL,
    Currency           CHAR(3)        NULL,
    CreatedBy          VARCHAR(100)   NULL,
    LeadTimeDays       INT            NULL,   -- derived
    IsDelayed          BIT            NULL,   -- derived
    Src_UpdatedDate    DATETIME       NULL,
    Brz_LoadedAt       DATETIME       NOT NULL DEFAULT GETDATE(),
    Brz_BatchID        INT            NOT NULL
);
GO

PRINT 'BronzeDB created — 14 br_ tables ready.';
GO
