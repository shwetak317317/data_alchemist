-- ============================================================
--  04_SP_Source_To_Raw.sql
--  Stored procedures: Source → RawDB (incremental)
--
--  One master orchestrator SP calls two source-specific SPs.
--  Each source SP:
--    1. Opens a new RawLoadLog batch
--    2. Reads the watermark for each table
--    3. Pulls only rows newer than the watermark
--    4. Inserts into the matching raw.schema.table
--    5. Updates the watermark to MAX of ingested values
--    6. Closes the batch log
--
--  All SPs run against linked-server-style 3-part names:
--    SourceDB_RetailMart.dbo.TableName
--    SourceDB_LogiShip.dbo.TableName
--  (Assumes both source DBs are on the same SQL Server instance.
--   Replace with linked server names if on different instances.)
-- ============================================================

USE RawDB;
GO

-- ============================================================
-- SP: usp_Raw_Load_RetailMart
-- ============================================================
CREATE OR ALTER PROCEDURE dbo.usp_Raw_Load_RetailMart
    @BatchID    INT OUTPUT,
    @RowsLoaded INT OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @StartTime  DATETIME = GETDATE();
    DECLARE @WatermarkVal DATETIME;
    DECLARE @MaxVal       DATETIME;
    DECLARE @Rows         INT = 0;
    DECLARE @TotalRows    INT = 0;

    -- Open batch log
    INSERT INTO dbo.RawLoadLog (TriggeredBy, Notes)
    VALUES ('usp_Raw_Load_RetailMart', 'Incremental load started');
    SET @BatchID = SCOPE_IDENTITY();

    BEGIN TRY
        -- ── Categories ──────────────────────────────────────
        SELECT @WatermarkVal = LastLoadedValue
        FROM   dbo.RawWatermark
        WHERE  SourceSystem = 'RetailMart' AND TableName = 'Categories';

        INSERT INTO retailmart.Categories
            (CategoryID, CategoryName, ParentCategoryID, IsActive, CreatedDate,
             Raw_SourceSystem, Raw_IngestedAt, Raw_BatchID)
        SELECT
            CategoryID, CategoryName, ParentCategoryID, IsActive, CreatedDate,
            'RetailMart', GETDATE(), @BatchID
        FROM SourceDB_RetailMart.dbo.Categories
        WHERE CreatedDate > @WatermarkVal;

        SET @Rows = @@ROWCOUNT;
        SET @TotalRows += @Rows;

        SELECT @MaxVal = ISNULL(MAX(CreatedDate), @WatermarkVal)
        FROM   SourceDB_RetailMart.dbo.Categories
        WHERE  CreatedDate > @WatermarkVal;

        UPDATE dbo.RawWatermark
        SET    LastLoadedValue = @MaxVal, UpdatedAt = GETDATE()
        WHERE  SourceSystem = 'RetailMart' AND TableName = 'Categories';

        -- ── Products ────────────────────────────────────────
        SELECT @WatermarkVal = LastLoadedValue
        FROM   dbo.RawWatermark
        WHERE  SourceSystem = 'RetailMart' AND TableName = 'Products';

        INSERT INTO retailmart.Products
            (ProductID, ProductName, CategoryID, SKU, BasePrice, CostPrice,
             StockQty, Weight_kg, IsActive, LaunchDate, CreatedDate, ModifiedDate,
             Raw_SourceSystem, Raw_IngestedAt, Raw_BatchID)
        SELECT
            ProductID, ProductName, CategoryID, SKU, BasePrice, CostPrice,
            StockQty, Weight_kg, IsActive, LaunchDate, CreatedDate, ModifiedDate,
            'RetailMart', GETDATE(), @BatchID
        FROM SourceDB_RetailMart.dbo.Products
        WHERE ISNULL(ModifiedDate, CreatedDate) > @WatermarkVal;

        SET @Rows = @@ROWCOUNT;  SET @TotalRows += @Rows;

        SELECT @MaxVal = ISNULL(MAX(ISNULL(ModifiedDate, CreatedDate)), @WatermarkVal)
        FROM   SourceDB_RetailMart.dbo.Products
        WHERE  ISNULL(ModifiedDate, CreatedDate) > @WatermarkVal;

        UPDATE dbo.RawWatermark SET LastLoadedValue = @MaxVal, UpdatedAt = GETDATE()
        WHERE SourceSystem = 'RetailMart' AND TableName = 'Products';

        -- ── Customers ───────────────────────────────────────
        SELECT @WatermarkVal = LastLoadedValue
        FROM   dbo.RawWatermark
        WHERE  SourceSystem = 'RetailMart' AND TableName = 'Customers';

        INSERT INTO retailmart.Customers
            (CustomerID, FirstName, LastName, Email, Phone, DateOfBirth,
             Gender, LoyaltyTier, RegisteredDate, ModifiedDate, IsActive, CountryCode,
             Raw_SourceSystem, Raw_IngestedAt, Raw_BatchID)
        SELECT
            CustomerID, FirstName, LastName, Email, Phone, DateOfBirth,
            Gender, LoyaltyTier, RegisteredDate, ModifiedDate, IsActive, CountryCode,
            'RetailMart', GETDATE(), @BatchID
        FROM SourceDB_RetailMart.dbo.Customers
        WHERE ISNULL(ModifiedDate, RegisteredDate) > @WatermarkVal;

        SET @Rows = @@ROWCOUNT;  SET @TotalRows += @Rows;

        SELECT @MaxVal = ISNULL(MAX(ISNULL(ModifiedDate, RegisteredDate)), @WatermarkVal)
        FROM   SourceDB_RetailMart.dbo.Customers
        WHERE  ISNULL(ModifiedDate, RegisteredDate) > @WatermarkVal;

        UPDATE dbo.RawWatermark SET LastLoadedValue = @MaxVal, UpdatedAt = GETDATE()
        WHERE SourceSystem = 'RetailMart' AND TableName = 'Customers';

        -- ── Promotions (full reload — small table, no timestamp) ──
        DELETE FROM retailmart.Promotions WHERE Raw_SourceSystem = 'RetailMart';

        INSERT INTO retailmart.Promotions
            (PromoID, PromoCode, Description, DiscountType, DiscountValue,
             MinOrderValue, StartDate, EndDate, IsActive,
             Raw_SourceSystem, Raw_IngestedAt, Raw_BatchID)
        SELECT
            PromoID, PromoCode, Description, DiscountType, DiscountValue,
            MinOrderValue, StartDate, EndDate, IsActive,
            'RetailMart', GETDATE(), @BatchID
        FROM SourceDB_RetailMart.dbo.Promotions;

        SET @Rows = @@ROWCOUNT;  SET @TotalRows += @Rows;

        -- ── Orders ──────────────────────────────────────────
        SELECT @WatermarkVal = LastLoadedValue
        FROM   dbo.RawWatermark
        WHERE  SourceSystem = 'RetailMart' AND TableName = 'Orders';

        INSERT INTO retailmart.Orders
            (OrderID, CustomerID, OrderDate, Status, TotalAmount, DiscountAmount,
             TaxAmount, ShippingAmount, NetPayable, PromoID, ShippingAddress,
             City, State, PinCode, IsDeleted, CreatedDate,
             Raw_SourceSystem, Raw_IngestedAt, Raw_BatchID)
        SELECT
            OrderID, CustomerID, OrderDate, Status, TotalAmount, DiscountAmount,
            TaxAmount, ShippingAmount, NetPayable, PromoID, ShippingAddress,
            City, State, PinCode, IsDeleted, CreatedDate,
            'RetailMart', GETDATE(), @BatchID
        FROM SourceDB_RetailMart.dbo.Orders
        WHERE CreatedDate > @WatermarkVal;

        SET @Rows = @@ROWCOUNT;  SET @TotalRows += @Rows;

        SELECT @MaxVal = ISNULL(MAX(CreatedDate), @WatermarkVal)
        FROM   SourceDB_RetailMart.dbo.Orders
        WHERE  CreatedDate > @WatermarkVal;

        UPDATE dbo.RawWatermark SET LastLoadedValue = @MaxVal, UpdatedAt = GETDATE()
        WHERE SourceSystem = 'RetailMart' AND TableName = 'Orders';

        -- ── OrderItems (load with parent orders: use OrderItemID as watermark) ──
        SELECT @WatermarkVal = LastLoadedValue
        FROM   dbo.RawWatermark
        WHERE  SourceSystem = 'RetailMart' AND TableName = 'OrderItems';

        -- convert stored DATETIME watermark to INT for PK comparison
        DECLARE @WatermarkID INT = CAST(@WatermarkVal AS INT);

        INSERT INTO retailmart.OrderItems
            (OrderItemID, OrderID, ProductID, Quantity, UnitPrice, LineTotal, Discount,
             Raw_SourceSystem, Raw_IngestedAt, Raw_BatchID)
        SELECT
            OrderItemID, OrderID, ProductID, Quantity, UnitPrice, LineTotal, Discount,
            'RetailMart', GETDATE(), @BatchID
        FROM SourceDB_RetailMart.dbo.OrderItems
        WHERE OrderItemID > @WatermarkID;

        SET @Rows = @@ROWCOUNT;  SET @TotalRows += @Rows;

        DECLARE @MaxItemID INT = 0;
        SELECT @MaxItemID = ISNULL(MAX(OrderItemID), @WatermarkID)
        FROM   SourceDB_RetailMart.dbo.OrderItems
        WHERE  OrderItemID > @WatermarkID;

        UPDATE dbo.RawWatermark
        SET    LastLoadedValue = CAST(@MaxItemID AS DATETIME), UpdatedAt = GETDATE()
        WHERE  SourceSystem = 'RetailMart' AND TableName = 'OrderItems';

        -- ── Payments ────────────────────────────────────────
        SELECT @WatermarkVal = LastLoadedValue
        FROM   dbo.RawWatermark
        WHERE  SourceSystem = 'RetailMart' AND TableName = 'Payments';

        INSERT INTO retailmart.Payments
            (PaymentID, OrderID, PaymentDate, PaymentMethod, PaymentStatus,
             AmountPaid, TransactionRef, GatewayName,
             Raw_SourceSystem, Raw_IngestedAt, Raw_BatchID)
        SELECT
            PaymentID, OrderID, PaymentDate, PaymentMethod, PaymentStatus,
            AmountPaid, TransactionRef, GatewayName,
            'RetailMart', GETDATE(), @BatchID
        FROM SourceDB_RetailMart.dbo.Payments
        WHERE PaymentDate > @WatermarkVal;

        SET @Rows = @@ROWCOUNT;  SET @TotalRows += @Rows;

        SELECT @MaxVal = ISNULL(MAX(PaymentDate), @WatermarkVal)
        FROM   SourceDB_RetailMart.dbo.Payments
        WHERE  PaymentDate > @WatermarkVal;

        UPDATE dbo.RawWatermark SET LastLoadedValue = @MaxVal, UpdatedAt = GETDATE()
        WHERE SourceSystem = 'RetailMart' AND TableName = 'Payments';

        -- ── Reviews ─────────────────────────────────────────
        SELECT @WatermarkVal = LastLoadedValue
        FROM   dbo.RawWatermark
        WHERE  SourceSystem = 'RetailMart' AND TableName = 'Reviews';

        INSERT INTO retailmart.Reviews
            (ReviewID, ProductID, CustomerID, Rating, ReviewText, ReviewDate,
             IsVerifiedBuyer, HelpfulVotes,
             Raw_SourceSystem, Raw_IngestedAt, Raw_BatchID)
        SELECT
            ReviewID, ProductID, CustomerID, Rating, ReviewText, ReviewDate,
            IsVerifiedBuyer, HelpfulVotes,
            'RetailMart', GETDATE(), @BatchID
        FROM SourceDB_RetailMart.dbo.Reviews
        WHERE ReviewDate > @WatermarkVal;

        SET @Rows = @@ROWCOUNT;  SET @TotalRows += @Rows;

        SELECT @MaxVal = ISNULL(MAX(ReviewDate), @WatermarkVal)
        FROM   SourceDB_RetailMart.dbo.Reviews
        WHERE  ReviewDate > @WatermarkVal;

        UPDATE dbo.RawWatermark SET LastLoadedValue = @MaxVal, UpdatedAt = GETDATE()
        WHERE SourceSystem = 'RetailMart' AND TableName = 'Reviews';

        -- Close batch
        SET @RowsLoaded = @TotalRows;
        UPDATE dbo.RawLoadLog
        SET    RunFinishedAt = GETDATE(), Status = 'Success',
               Notes = CONCAT('RetailMart load complete. Rows: ', @TotalRows)
        WHERE  BatchID = @BatchID;

    END TRY
    BEGIN CATCH
        UPDATE dbo.RawLoadLog
        SET    RunFinishedAt = GETDATE(), Status = 'Failed',
               Notes = ERROR_MESSAGE()
        WHERE  BatchID = @BatchID;
        THROW;
    END CATCH;
END;
GO

-- ============================================================
-- SP: usp_Raw_Load_LogiShip
-- ============================================================
CREATE OR ALTER PROCEDURE dbo.usp_Raw_Load_LogiShip
    @BatchID    INT OUTPUT,
    @RowsLoaded INT OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @WatermarkVal DATETIME;
    DECLARE @MaxVal       DATETIME;
    DECLARE @Rows         INT = 0;
    DECLARE @TotalRows    INT = 0;

    INSERT INTO dbo.RawLoadLog (TriggeredBy, Notes)
    VALUES ('usp_Raw_Load_LogiShip', 'Incremental load started');
    SET @BatchID = SCOPE_IDENTITY();

    BEGIN TRY

        -- Macro to avoid repetition: for each table, pattern is identical.
        -- ── ProductCategories ───────────────────────────────
        SELECT @WatermarkVal = LastLoadedValue FROM dbo.RawWatermark
        WHERE SourceSystem='LogiShip' AND TableName='ProductCategories';

        INSERT INTO logiship.ProductCategories
            (CatID,CatName,ParentCatID,ActiveFlag,CreatedTs,UpdatedTs,
             Raw_SourceSystem,Raw_IngestedAt,Raw_BatchID)
        SELECT CatID,CatName,ParentCatID,ActiveFlag,CreatedTs,UpdatedTs,
               'LogiShip',GETDATE(),@BatchID
        FROM SourceDB_LogiShip.dbo.ProductCategories
        WHERE UpdatedTs > @WatermarkVal;

        SET @Rows=@@ROWCOUNT; SET @TotalRows+=@Rows;
        SELECT @MaxVal=ISNULL(MAX(UpdatedTs),@WatermarkVal) FROM SourceDB_LogiShip.dbo.ProductCategories WHERE UpdatedTs>@WatermarkVal;
        UPDATE dbo.RawWatermark SET LastLoadedValue=@MaxVal,UpdatedAt=GETDATE() WHERE SourceSystem='LogiShip' AND TableName='ProductCategories';

        -- ── ProductCatalog ──────────────────────────────────
        SELECT @WatermarkVal = LastLoadedValue FROM dbo.RawWatermark
        WHERE SourceSystem='LogiShip' AND TableName='ProductCatalog';

        INSERT INTO logiship.ProductCatalog
            (ProdID,ProdTitle,CatID,BarCode,ListPrice,PurchasePrice,
             AvailableQty,WeightGrams,ActiveFlag,ReleaseDt,CreatedTs,LastUpdatedTs,
             Raw_SourceSystem,Raw_IngestedAt,Raw_BatchID)
        SELECT ProdID,ProdTitle,CatID,BarCode,ListPrice,PurchasePrice,
               AvailableQty,WeightGrams,ActiveFlag,ReleaseDt,CreatedTs,LastUpdatedTs,
               'LogiShip',GETDATE(),@BatchID
        FROM SourceDB_LogiShip.dbo.ProductCatalog
        WHERE LastUpdatedTs > @WatermarkVal;

        SET @Rows=@@ROWCOUNT; SET @TotalRows+=@Rows;
        SELECT @MaxVal=ISNULL(MAX(LastUpdatedTs),@WatermarkVal) FROM SourceDB_LogiShip.dbo.ProductCatalog WHERE LastUpdatedTs>@WatermarkVal;
        UPDATE dbo.RawWatermark SET LastLoadedValue=@MaxVal,UpdatedAt=GETDATE() WHERE SourceSystem='LogiShip' AND TableName='ProductCatalog';

        -- ── Members ─────────────────────────────────────────
        SELECT @WatermarkVal = LastLoadedValue FROM dbo.RawWatermark
        WHERE SourceSystem='LogiShip' AND TableName='Members';

        INSERT INTO logiship.Members
            (MemberID,GivenName,Surname,EmailAddr,MobileNo,BirthDate,
             GenderCode,MembershipLevel,JoinedDt,ActiveFlag,CountryISO,UpdatedTs,
             Raw_SourceSystem,Raw_IngestedAt,Raw_BatchID)
        SELECT MemberID,GivenName,Surname,EmailAddr,MobileNo,BirthDate,
               GenderCode,MembershipLevel,JoinedDt,ActiveFlag,CountryISO,UpdatedTs,
               'LogiShip',GETDATE(),@BatchID
        FROM SourceDB_LogiShip.dbo.Members
        WHERE UpdatedTs > @WatermarkVal;

        SET @Rows=@@ROWCOUNT; SET @TotalRows+=@Rows;
        SELECT @MaxVal=ISNULL(MAX(UpdatedTs),@WatermarkVal) FROM SourceDB_LogiShip.dbo.Members WHERE UpdatedTs>@WatermarkVal;
        UPDATE dbo.RawWatermark SET LastLoadedValue=@MaxVal,UpdatedAt=GETDATE() WHERE SourceSystem='LogiShip' AND TableName='Members';

        -- ── Deals ───────────────────────────────────────────
        DELETE FROM logiship.Deals WHERE Raw_SourceSystem='LogiShip';  -- full reload (small table)

        INSERT INTO logiship.Deals
            (DealID,CouponCode,DealDesc,DiscType,DiscAmount,MinCartValue,
             ValidFrom,ValidTo,IsLive,UpdatedTs,
             Raw_SourceSystem,Raw_IngestedAt,Raw_BatchID)
        SELECT DealID,CouponCode,DealDesc,DiscType,DiscAmount,MinCartValue,
               ValidFrom,ValidTo,IsLive,UpdatedTs,
               'LogiShip',GETDATE(),@BatchID
        FROM SourceDB_LogiShip.dbo.Deals;

        SET @Rows=@@ROWCOUNT; SET @TotalRows+=@Rows;

        -- ── SalesOrders ─────────────────────────────────────
        SELECT @WatermarkVal = LastLoadedValue FROM dbo.RawWatermark
        WHERE SourceSystem='LogiShip' AND TableName='SalesOrders';

        INSERT INTO logiship.SalesOrders
            (SOrderID,MemberID,OrderDt,OrderState,GrossAmt,DiscAmt,TaxAmt,
             FreightAmt,NetAmt,DealID,DelivAddr,DelivCity,DelivState,
             PostalCode,DeletedFlag,CreatedTs,UpdatedTs,
             Raw_SourceSystem,Raw_IngestedAt,Raw_BatchID)
        SELECT SOrderID,MemberID,OrderDt,OrderState,GrossAmt,DiscAmt,TaxAmt,
               FreightAmt,NetAmt,DealID,DelivAddr,DelivCity,DelivState,
               PostalCode,DeletedFlag,CreatedTs,UpdatedTs,
               'LogiShip',GETDATE(),@BatchID
        FROM SourceDB_LogiShip.dbo.SalesOrders
        WHERE UpdatedTs > @WatermarkVal;

        SET @Rows=@@ROWCOUNT; SET @TotalRows+=@Rows;
        SELECT @MaxVal=ISNULL(MAX(UpdatedTs),@WatermarkVal) FROM SourceDB_LogiShip.dbo.SalesOrders WHERE UpdatedTs>@WatermarkVal;
        UPDATE dbo.RawWatermark SET LastLoadedValue=@MaxVal,UpdatedAt=GETDATE() WHERE SourceSystem='LogiShip' AND TableName='SalesOrders';

        -- ── SalesOrderLines ─────────────────────────────────
        SELECT @WatermarkVal = LastLoadedValue FROM dbo.RawWatermark
        WHERE SourceSystem='LogiShip' AND TableName='SalesOrderLines';

        INSERT INTO logiship.SalesOrderLines
            (LineID,SOrderID,ProdID,Qty,SellingPrice,LineTotalAmt,LineDisc,UpdatedTs,
             Raw_SourceSystem,Raw_IngestedAt,Raw_BatchID)
        SELECT LineID,SOrderID,ProdID,Qty,SellingPrice,LineTotalAmt,LineDisc,UpdatedTs,
               'LogiShip',GETDATE(),@BatchID
        FROM SourceDB_LogiShip.dbo.SalesOrderLines
        WHERE UpdatedTs > @WatermarkVal;

        SET @Rows=@@ROWCOUNT; SET @TotalRows+=@Rows;
        SELECT @MaxVal=ISNULL(MAX(UpdatedTs),@WatermarkVal) FROM SourceDB_LogiShip.dbo.SalesOrderLines WHERE UpdatedTs>@WatermarkVal;
        UPDATE dbo.RawWatermark SET LastLoadedValue=@MaxVal,UpdatedAt=GETDATE() WHERE SourceSystem='LogiShip' AND TableName='SalesOrderLines';

        -- ── Transactions ────────────────────────────────────
        SELECT @WatermarkVal = LastLoadedValue FROM dbo.RawWatermark
        WHERE SourceSystem='LogiShip' AND TableName='Transactions';

        INSERT INTO logiship.Transactions
            (TxnID,SOrderID,TxnDt,PayMode,TxnStatus,PaidAmt,TxnRef,PGName,UpdatedTs,
             Raw_SourceSystem,Raw_IngestedAt,Raw_BatchID)
        SELECT TxnID,SOrderID,TxnDt,PayMode,TxnStatus,PaidAmt,TxnRef,PGName,UpdatedTs,
               'LogiShip',GETDATE(),@BatchID
        FROM SourceDB_LogiShip.dbo.Transactions
        WHERE UpdatedTs > @WatermarkVal;

        SET @Rows=@@ROWCOUNT; SET @TotalRows+=@Rows;
        SELECT @MaxVal=ISNULL(MAX(UpdatedTs),@WatermarkVal) FROM SourceDB_LogiShip.dbo.Transactions WHERE UpdatedTs>@WatermarkVal;
        UPDATE dbo.RawWatermark SET LastLoadedValue=@MaxVal,UpdatedAt=GETDATE() WHERE SourceSystem='LogiShip' AND TableName='Transactions';

        -- ── ProductReviews ──────────────────────────────────
        SELECT @WatermarkVal = LastLoadedValue FROM dbo.RawWatermark
        WHERE SourceSystem='LogiShip' AND TableName='ProductReviews';

        INSERT INTO logiship.ProductReviews
            (ReviewID,ProdID,MemberID,StarRating,ReviewBody,ReviewDt,
             VerifiedPurchase,UsefulCount,UpdatedTs,
             Raw_SourceSystem,Raw_IngestedAt,Raw_BatchID)
        SELECT ReviewID,ProdID,MemberID,StarRating,ReviewBody,ReviewDt,
               VerifiedPurchase,UsefulCount,UpdatedTs,
               'LogiShip',GETDATE(),@BatchID
        FROM SourceDB_LogiShip.dbo.ProductReviews
        WHERE UpdatedTs > @WatermarkVal;

        SET @Rows=@@ROWCOUNT; SET @TotalRows+=@Rows;
        SELECT @MaxVal=ISNULL(MAX(UpdatedTs),@WatermarkVal) FROM SourceDB_LogiShip.dbo.ProductReviews WHERE UpdatedTs>@WatermarkVal;
        UPDATE dbo.RawWatermark SET LastLoadedValue=@MaxVal,UpdatedAt=GETDATE() WHERE SourceSystem='LogiShip' AND TableName='ProductReviews';

        -- ── Warehouses ──────────────────────────────────────
        SELECT @WatermarkVal = LastLoadedValue FROM dbo.RawWatermark
        WHERE SourceSystem='LogiShip' AND TableName='Warehouses';

        INSERT INTO logiship.Warehouses
            (WH_ID,WH_Name,WH_City,WH_State,CountryCode,CapacityUnits,
             IsOperational,ManagerName,Phone,OpenedOn,UpdatedTs,
             Raw_SourceSystem,Raw_IngestedAt,Raw_BatchID)
        SELECT WH_ID,WH_Name,WH_City,WH_State,CountryCode,CapacityUnits,
               IsOperational,ManagerName,Phone,OpenedOn,UpdatedTs,
               'LogiShip',GETDATE(),@BatchID
        FROM SourceDB_LogiShip.dbo.Warehouses
        WHERE UpdatedTs > @WatermarkVal;

        SET @Rows=@@ROWCOUNT; SET @TotalRows+=@Rows;
        SELECT @MaxVal=ISNULL(MAX(UpdatedTs),@WatermarkVal) FROM SourceDB_LogiShip.dbo.Warehouses WHERE UpdatedTs>@WatermarkVal;
        UPDATE dbo.RawWatermark SET LastLoadedValue=@MaxVal,UpdatedAt=GETDATE() WHERE SourceSystem='LogiShip' AND TableName='Warehouses';

        -- ── Shipments ───────────────────────────────────────
        SELECT @WatermarkVal = LastLoadedValue FROM dbo.RawWatermark
        WHERE SourceSystem='LogiShip' AND TableName='Shipments';

        INSERT INTO logiship.Shipments
            (ShipID,SOrderID,WH_ID,DispatchDt,EstDelivDt,ActDelivDt,
             CourierCode,AWBNumber,ShipState,FreightCharge,ChargedWtKg,UpdatedTs,
             Raw_SourceSystem,Raw_IngestedAt,Raw_BatchID)
        SELECT ShipID,SOrderID,WH_ID,DispatchDt,EstDelivDt,ActDelivDt,
               CourierCode,AWBNumber,ShipState,FreightCharge,ChargedWtKg,UpdatedTs,
               'LogiShip',GETDATE(),@BatchID
        FROM SourceDB_LogiShip.dbo.Shipments
        WHERE UpdatedTs > @WatermarkVal;

        SET @Rows=@@ROWCOUNT; SET @TotalRows+=@Rows;
        SELECT @MaxVal=ISNULL(MAX(UpdatedTs),@WatermarkVal) FROM SourceDB_LogiShip.dbo.Shipments WHERE UpdatedTs>@WatermarkVal;
        UPDATE dbo.RawWatermark SET LastLoadedValue=@MaxVal,UpdatedAt=GETDATE() WHERE SourceSystem='LogiShip' AND TableName='Shipments';

        -- ── Returns ─────────────────────────────────────────
        SELECT @WatermarkVal = LastLoadedValue FROM dbo.RawWatermark
        WHERE SourceSystem='LogiShip' AND TableName='Returns';

        INSERT INTO logiship.Returns
            (RetID,SOrderID,ShipID,ReturnDt,ReturnReason,RetStatus,
             RefundAmt,ReturnedBarCode,RetQty,QCNotes,UpdatedTs,
             Raw_SourceSystem,Raw_IngestedAt,Raw_BatchID)
        SELECT RetID,SOrderID,ShipID,ReturnDt,ReturnReason,RetStatus,
               RefundAmt,ReturnedBarCode,RetQty,QCNotes,UpdatedTs,
               'LogiShip',GETDATE(),@BatchID
        FROM SourceDB_LogiShip.dbo.Returns
        WHERE UpdatedTs > @WatermarkVal;

        SET @Rows=@@ROWCOUNT; SET @TotalRows+=@Rows;
        SELECT @MaxVal=ISNULL(MAX(UpdatedTs),@WatermarkVal) FROM SourceDB_LogiShip.dbo.Returns WHERE UpdatedTs>@WatermarkVal;
        UPDATE dbo.RawWatermark SET LastLoadedValue=@MaxVal,UpdatedAt=GETDATE() WHERE SourceSystem='LogiShip' AND TableName='Returns';

        -- ── Suppliers ───────────────────────────────────────
        SELECT @WatermarkVal = LastLoadedValue FROM dbo.RawWatermark
        WHERE SourceSystem='LogiShip' AND TableName='Suppliers';

        INSERT INTO logiship.Suppliers
            (SupID,SupName,SupEmail,SupPhone,CountryCode,LeadDays,
             PayTerms,SupRating,ActiveFlag,OnboardDt,UpdatedTs,
             Raw_SourceSystem,Raw_IngestedAt,Raw_BatchID)
        SELECT SupID,SupName,SupEmail,SupPhone,CountryCode,LeadDays,
               PayTerms,SupRating,ActiveFlag,OnboardDt,UpdatedTs,
               'LogiShip',GETDATE(),@BatchID
        FROM SourceDB_LogiShip.dbo.Suppliers
        WHERE UpdatedTs > @WatermarkVal;

        SET @Rows=@@ROWCOUNT; SET @TotalRows+=@Rows;
        SELECT @MaxVal=ISNULL(MAX(UpdatedTs),@WatermarkVal) FROM SourceDB_LogiShip.dbo.Suppliers WHERE UpdatedTs>@WatermarkVal;
        UPDATE dbo.RawWatermark SET LastLoadedValue=@MaxVal,UpdatedAt=GETDATE() WHERE SourceSystem='LogiShip' AND TableName='Suppliers';

        -- ── StockLedger ─────────────────────────────────────
        SELECT @WatermarkVal = LastLoadedValue FROM dbo.RawWatermark
        WHERE SourceSystem='LogiShip' AND TableName='StockLedger';

        INSERT INTO logiship.StockLedger
            (LedgerID,BarCode,WH_ID,QtyOnHand,QtyReserved,ReorderLevel,
             ReplenishQty,LastStockDt,LastAuditDt,SupID,UpdatedTs,
             Raw_SourceSystem,Raw_IngestedAt,Raw_BatchID)
        SELECT LedgerID,BarCode,WH_ID,QtyOnHand,QtyReserved,ReorderLevel,
               ReplenishQty,LastStockDt,LastAuditDt,SupID,UpdatedTs,
               'LogiShip',GETDATE(),@BatchID
        FROM SourceDB_LogiShip.dbo.StockLedger
        WHERE UpdatedTs > @WatermarkVal;

        SET @Rows=@@ROWCOUNT; SET @TotalRows+=@Rows;
        SELECT @MaxVal=ISNULL(MAX(UpdatedTs),@WatermarkVal) FROM SourceDB_LogiShip.dbo.StockLedger WHERE UpdatedTs>@WatermarkVal;
        UPDATE dbo.RawWatermark SET LastLoadedValue=@MaxVal,UpdatedAt=GETDATE() WHERE SourceSystem='LogiShip' AND TableName='StockLedger';

        -- ── ProcurementOrders ───────────────────────────────
        SELECT @WatermarkVal = LastLoadedValue FROM dbo.RawWatermark
        WHERE SourceSystem='LogiShip' AND TableName='ProcurementOrders';

        INSERT INTO logiship.ProcurementOrders
            (POID,SupID,WH_ID,PODt,ExpArrDt,ActArrDt,POState,
             OrderValue,CurrencyCode,CreatedBy,UpdatedTs,
             Raw_SourceSystem,Raw_IngestedAt,Raw_BatchID)
        SELECT POID,SupID,WH_ID,PODt,ExpArrDt,ActArrDt,POState,
               OrderValue,CurrencyCode,CreatedBy,UpdatedTs,
               'LogiShip',GETDATE(),@BatchID
        FROM SourceDB_LogiShip.dbo.ProcurementOrders
        WHERE UpdatedTs > @WatermarkVal;

        SET @Rows=@@ROWCOUNT; SET @TotalRows+=@Rows;
        SELECT @MaxVal=ISNULL(MAX(UpdatedTs),@WatermarkVal) FROM SourceDB_LogiShip.dbo.ProcurementOrders WHERE UpdatedTs>@WatermarkVal;
        UPDATE dbo.RawWatermark SET LastLoadedValue=@MaxVal,UpdatedAt=GETDATE() WHERE SourceSystem='LogiShip' AND TableName='ProcurementOrders';

        SET @RowsLoaded = @TotalRows;
        UPDATE dbo.RawLoadLog
        SET RunFinishedAt=GETDATE(), Status='Success',
            Notes=CONCAT('LogiShip load complete. Rows: ',@TotalRows)
        WHERE BatchID=@BatchID;

    END TRY
    BEGIN CATCH
        UPDATE dbo.RawLoadLog
        SET RunFinishedAt=GETDATE(), Status='Failed', Notes=ERROR_MESSAGE()
        WHERE BatchID=@BatchID;
        THROW;
    END CATCH;
END;
GO

-- ============================================================
-- SP: usp_Raw_Load_All  (master orchestrator)
-- ============================================================
CREATE OR ALTER PROCEDURE dbo.usp_Raw_Load_All
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @BatchID INT, @Rows INT;

    PRINT '=== Source → Raw: RetailMart ===';
    EXEC dbo.usp_Raw_Load_RetailMart @BatchID=@BatchID OUTPUT, @RowsLoaded=@Rows OUTPUT;
    PRINT CONCAT('  BatchID=', @BatchID, '  Rows=', @Rows);

    PRINT '=== Source → Raw: LogiShip ===';
    EXEC dbo.usp_Raw_Load_LogiShip @BatchID=@BatchID OUTPUT, @RowsLoaded=@Rows OUTPUT;
    PRINT CONCAT('  BatchID=', @BatchID, '  Rows=', @Rows);

    PRINT '=== Raw load complete ===';
END;
GO

PRINT '04_SP_Source_To_Raw.sql installed successfully.';
GO
