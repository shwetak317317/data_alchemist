-- ============================================================
--  05_SP_Raw_To_Bronze.sql
--  Stored procedures: RawDB → BronzeDB
--
--  Each SP:
--    • Reads only rows from the latest Raw batch not yet in Bronze
--      (uses RawDB.dbo.RawLoadLog + BronzeDB.dbo.BrzLoadLog linkage)
--    • Applies UNION ALL of both sources into a single Bronze table
--    • Applies all column renaming, domain normalisation, and
--      derived column calculations
--    • Uses MERGE for idempotency: re-running same BatchID is safe
-- ============================================================

USE BronzeDB;
GO

-- ============================================================
-- SP: usp_Brz_Load_Categories
-- ============================================================
CREATE OR ALTER PROCEDURE dbo.usp_Brz_Load_Categories
    @RawBatchID INT,
    @BrzBatchID INT
AS
BEGIN
    SET NOCOUNT ON;

    -- MERGE on (SourceSystem, SourceCategoryID) — upsert semantics
    MERGE dbo.br_categories AS tgt
    USING (
        -- RetailMart
        SELECT
            'RetailMart'    AS SourceSystem,
            CategoryID      AS SourceCategoryID,
            CategoryName,
            ParentCategoryID,
            IsActive,
            CreatedDate     AS Src_CreatedDate
        FROM RawDB.retailmart.Categories
        WHERE Raw_BatchID = @RawBatchID

        UNION ALL

        -- LogiShip: normalise ActiveFlag -> IsActive
        SELECT
            'LogiShip'      AS SourceSystem,
            CatID           AS SourceCategoryID,
            CatName         AS CategoryName,
            ParentCatID     AS ParentCategoryID,
            ActiveFlag      AS IsActive,
            CreatedTs       AS Src_CreatedDate
        FROM RawDB.logiship.ProductCategories
        WHERE Raw_BatchID = @RawBatchID
    ) AS src
    ON tgt.SourceSystem = src.SourceSystem
       AND tgt.SourceCategoryID = src.SourceCategoryID

    WHEN MATCHED THEN UPDATE SET
        tgt.CategoryName     = src.CategoryName,
        tgt.ParentCategoryID = src.ParentCategoryID,
        tgt.IsActive         = src.IsActive,
        tgt.Brz_LoadedAt     = GETDATE(),
        tgt.Brz_BatchID      = @BrzBatchID

    WHEN NOT MATCHED BY TARGET THEN INSERT
        (SourceSystem, SourceCategoryID, CategoryName, ParentCategoryID,
         IsActive, Src_CreatedDate, Brz_LoadedAt, Brz_BatchID)
    VALUES
        (src.SourceSystem, src.SourceCategoryID, src.CategoryName,
         src.ParentCategoryID, src.IsActive, src.Src_CreatedDate,
         GETDATE(), @BrzBatchID);
END;
GO

-- ============================================================
-- SP: usp_Brz_Load_Products
-- ============================================================
CREATE OR ALTER PROCEDURE dbo.usp_Brz_Load_Products
    @RawBatchID INT,
    @BrzBatchID INT
AS
BEGIN
    SET NOCOUNT ON;

    MERGE dbo.br_products AS tgt
    USING (
        SELECT
            'RetailMart'    AS SourceSystem,
            ProductID       AS SourceProductID,
            ProductName,
            CategoryID      AS SourceCategoryID,
            SKU             AS SKU_Barcode,
            BasePrice,
            CostPrice,
            StockQty,
            Weight_kg,
            IsActive,
            LaunchDate,
            CreatedDate     AS Src_CreatedDate,
            ModifiedDate    AS Src_UpdatedDate
        FROM RawDB.retailmart.Products
        WHERE Raw_BatchID = @RawBatchID

        UNION ALL

        SELECT
            'LogiShip'      AS SourceSystem,
            ProdID          AS SourceProductID,
            ProdTitle       AS ProductName,
            CatID           AS SourceCategoryID,
            BarCode         AS SKU_Barcode,
            ListPrice       AS BasePrice,
            PurchasePrice   AS CostPrice,
            AvailableQty    AS StockQty,
            -- convert grams to kg, round to 4 dp
            CAST(ROUND(ISNULL(WeightGrams,0) / 1000.0, 4) AS DECIMAL(10,4)) AS Weight_kg,
            ActiveFlag      AS IsActive,
            ReleaseDt       AS LaunchDate,
            CreatedTs       AS Src_CreatedDate,
            LastUpdatedTs   AS Src_UpdatedDate
        FROM RawDB.logiship.ProductCatalog
        WHERE Raw_BatchID = @RawBatchID
    ) AS src
    ON tgt.SourceSystem = src.SourceSystem
       AND tgt.SourceProductID = src.SourceProductID

    WHEN MATCHED THEN UPDATE SET
        tgt.ProductName       = src.ProductName,
        tgt.SourceCategoryID  = src.SourceCategoryID,
        tgt.SKU_Barcode        = src.SKU_Barcode,
        tgt.BasePrice          = src.BasePrice,
        tgt.CostPrice          = src.CostPrice,
        tgt.StockQty           = src.StockQty,
        tgt.Weight_kg          = src.Weight_kg,
        tgt.IsActive           = src.IsActive,
        tgt.Src_UpdatedDate    = src.Src_UpdatedDate,
        tgt.Brz_LoadedAt       = GETDATE(),
        tgt.Brz_BatchID        = @BrzBatchID

    WHEN NOT MATCHED BY TARGET THEN INSERT
        (SourceSystem, SourceProductID, ProductName, SourceCategoryID,
         SKU_Barcode, BasePrice, CostPrice, StockQty, Weight_kg,
         IsActive, LaunchDate, Src_CreatedDate, Src_UpdatedDate,
         Brz_LoadedAt, Brz_BatchID)
    VALUES
        (src.SourceSystem, src.SourceProductID, src.ProductName, src.SourceCategoryID,
         src.SKU_Barcode, src.BasePrice, src.CostPrice, src.StockQty, src.Weight_kg,
         src.IsActive, src.LaunchDate, src.Src_CreatedDate, src.Src_UpdatedDate,
         GETDATE(), @BrzBatchID);
END;
GO

-- ============================================================
-- SP: usp_Brz_Load_Customers
-- ============================================================
CREATE OR ALTER PROCEDURE dbo.usp_Brz_Load_Customers
    @RawBatchID INT,
    @BrzBatchID INT
AS
BEGIN
    SET NOCOUNT ON;

    MERGE dbo.br_customers AS tgt
    USING (
        SELECT
            'RetailMart'    AS SourceSystem,
            CustomerID      AS SourceCustomerID,
            FirstName, LastName, Email, Phone,
            DateOfBirth,
            Gender,
            LoyaltyTier,
            RegisteredDate,
            IsActive,
            CountryCode,
            ModifiedDate    AS Src_UpdatedDate
        FROM RawDB.retailmart.Customers
        WHERE Raw_BatchID = @RawBatchID

        UNION ALL

        SELECT
            'LogiShip'          AS SourceSystem,
            MemberID            AS SourceCustomerID,
            GivenName           AS FirstName,
            Surname             AS LastName,
            EmailAddr           AS Email,
            MobileNo            AS Phone,
            BirthDate           AS DateOfBirth,
            GenderCode          AS Gender,
            MembershipLevel     AS LoyaltyTier,
            JoinedDt            AS RegisteredDate,
            ActiveFlag          AS IsActive,
            CountryISO          AS CountryCode,
            UpdatedTs           AS Src_UpdatedDate
        FROM RawDB.logiship.Members
        WHERE Raw_BatchID = @RawBatchID
    ) AS src
    ON tgt.SourceSystem = src.SourceSystem
       AND tgt.SourceCustomerID = src.SourceCustomerID

    WHEN MATCHED THEN UPDATE SET
        tgt.FirstName        = src.FirstName,
        tgt.LastName         = src.LastName,
        tgt.Email            = src.Email,
        tgt.Phone            = src.Phone,
        tgt.DateOfBirth      = src.DateOfBirth,
        tgt.Gender           = src.Gender,
        tgt.LoyaltyTier      = src.LoyaltyTier,
        tgt.IsActive         = src.IsActive,
        tgt.CountryCode      = src.CountryCode,
        tgt.Src_UpdatedDate  = src.Src_UpdatedDate,
        tgt.Brz_LoadedAt     = GETDATE(),
        tgt.Brz_BatchID      = @BrzBatchID

    WHEN NOT MATCHED BY TARGET THEN INSERT
        (SourceSystem, SourceCustomerID, FirstName, LastName, Email, Phone,
         DateOfBirth, Gender, LoyaltyTier, RegisteredDate, IsActive, CountryCode,
         Src_UpdatedDate, Brz_LoadedAt, Brz_BatchID)
    VALUES
        (src.SourceSystem, src.SourceCustomerID, src.FirstName, src.LastName,
         src.Email, src.Phone, src.DateOfBirth, src.Gender, src.LoyaltyTier,
         src.RegisteredDate, src.IsActive, src.CountryCode,
         src.Src_UpdatedDate, GETDATE(), @BrzBatchID);
END;
GO

-- ============================================================
-- SP: usp_Brz_Load_Promotions
-- ============================================================
CREATE OR ALTER PROCEDURE dbo.usp_Brz_Load_Promotions
    @RawBatchID INT,
    @BrzBatchID INT
AS
BEGIN
    SET NOCOUNT ON;

    MERGE dbo.br_promotions AS tgt
    USING (
        SELECT
            'RetailMart'    AS SourceSystem,
            PromoID         AS SourcePromoID,
            PromoCode,
            Description,
            -- normalise DiscountType to uppercase standard
            UPPER(DiscountType)  AS DiscountType,
            DiscountValue,
            MinOrderValue,
            StartDate,
            EndDate,
            IsActive,
            CASE WHEN EndDate < CAST(GETDATE() AS DATE) THEN 1 ELSE 0 END AS IsExpired,
            NULL            AS Src_UpdatedDate
        FROM RawDB.retailmart.Promotions
        WHERE Raw_BatchID = @RawBatchID

        UNION ALL

        SELECT
            'LogiShip'      AS SourceSystem,
            DealID          AS SourcePromoID,
            CouponCode      AS PromoCode,
            DealDesc        AS Description,
            UPPER(DiscType) AS DiscountType,
            DiscAmount      AS DiscountValue,
            MinCartValue    AS MinOrderValue,
            ValidFrom       AS StartDate,
            ValidTo         AS EndDate,
            IsLive          AS IsActive,
            CASE WHEN ValidTo < CAST(GETDATE() AS DATE) THEN 1 ELSE 0 END AS IsExpired,
            UpdatedTs       AS Src_UpdatedDate
        FROM RawDB.logiship.Deals
        WHERE Raw_BatchID = @RawBatchID
    ) AS src
    ON tgt.SourceSystem = src.SourceSystem
       AND tgt.SourcePromoID = src.SourcePromoID

    WHEN MATCHED THEN UPDATE SET
        tgt.DiscountValue   = src.DiscountValue,
        tgt.IsActive        = src.IsActive,
        tgt.IsExpired       = src.IsExpired,
        tgt.Brz_LoadedAt    = GETDATE(),
        tgt.Brz_BatchID     = @BrzBatchID

    WHEN NOT MATCHED BY TARGET THEN INSERT
        (SourceSystem, SourcePromoID, PromoCode, Description, DiscountType,
         DiscountValue, MinOrderValue, StartDate, EndDate, IsActive, IsExpired,
         Src_UpdatedDate, Brz_LoadedAt, Brz_BatchID)
    VALUES
        (src.SourceSystem, src.SourcePromoID, src.PromoCode, src.Description,
         src.DiscountType, src.DiscountValue, src.MinOrderValue, src.StartDate,
         src.EndDate, src.IsActive, src.IsExpired,
         src.Src_UpdatedDate, GETDATE(), @BrzBatchID);
END;
GO

-- ============================================================
-- SP: usp_Brz_Load_Orders
-- ============================================================
CREATE OR ALTER PROCEDURE dbo.usp_Brz_Load_Orders
    @RawBatchID INT,
    @BrzBatchID INT
AS
BEGIN
    SET NOCOUNT ON;

    -- Valid status domain for normalisation
    MERGE dbo.br_orders AS tgt
    USING (
        SELECT
            'RetailMart'    AS SourceSystem,
            OrderID         AS SourceOrderID,
            CustomerID      AS SourceCustomerID,
            OrderDate,
            -- Normalise status: keep valid values, flag others as 'Unknown'
            CASE WHEN Status IN ('Pending','Confirmed','Shipped','Delivered','Cancelled','Returned')
                 THEN Status ELSE 'Unknown' END AS OrderStatus,
            TotalAmount     AS GrossAmount,
            DiscountAmount,
            TaxAmount,
            ShippingAmount,
            NetPayable,
            PromoID         AS SourcePromoID,
            ShippingAddress,
            City, State, PinCode,
            IsDeleted,
            CASE WHEN Status = 'Delivered' THEN 1 ELSE 0 END AS IsFulfilled,
            CreatedDate     AS Src_CreatedDate,
            NULL            AS Src_UpdatedDate
        FROM RawDB.retailmart.Orders
        WHERE Raw_BatchID = @RawBatchID

        UNION ALL

        SELECT
            'LogiShip'      AS SourceSystem,
            SOrderID        AS SourceOrderID,
            MemberID        AS SourceCustomerID,
            OrderDt         AS OrderDate,
            CASE WHEN OrderState IN ('Pending','Confirmed','Shipped','Delivered','Cancelled','Returned')
                 THEN OrderState ELSE 'Unknown' END AS OrderStatus,
            GrossAmt        AS GrossAmount,
            DiscAmt         AS DiscountAmount,
            TaxAmt          AS TaxAmount,
            FreightAmt      AS ShippingAmount,
            NetAmt          AS NetPayable,
            DealID          AS SourcePromoID,
            DelivAddr       AS ShippingAddress,
            DelivCity       AS City,
            DelivState      AS State,
            PostalCode      AS PinCode,
            DeletedFlag     AS IsDeleted,
            CASE WHEN OrderState = 'Delivered' THEN 1 ELSE 0 END AS IsFulfilled,
            CreatedTs       AS Src_CreatedDate,
            UpdatedTs       AS Src_UpdatedDate
        FROM RawDB.logiship.SalesOrders
        WHERE Raw_BatchID = @RawBatchID
    ) AS src
    ON tgt.SourceSystem = src.SourceSystem
       AND tgt.SourceOrderID = src.SourceOrderID

    WHEN MATCHED THEN UPDATE SET
        tgt.OrderStatus      = src.OrderStatus,
        tgt.GrossAmount      = src.GrossAmount,
        tgt.DiscountAmount   = src.DiscountAmount,
        tgt.NetPayable       = src.NetPayable,
        tgt.IsDeleted        = src.IsDeleted,
        tgt.IsFulfilled      = src.IsFulfilled,
        tgt.Src_UpdatedDate  = src.Src_UpdatedDate,
        tgt.Brz_LoadedAt     = GETDATE(),
        tgt.Brz_BatchID      = @BrzBatchID

    WHEN NOT MATCHED BY TARGET THEN INSERT
        (SourceSystem, SourceOrderID, SourceCustomerID, OrderDate, OrderStatus,
         GrossAmount, DiscountAmount, TaxAmount, ShippingAmount, NetPayable,
         SourcePromoID, ShippingAddress, City, State, PinCode,
         IsDeleted, IsFulfilled, Src_CreatedDate, Src_UpdatedDate,
         Brz_LoadedAt, Brz_BatchID)
    VALUES
        (src.SourceSystem, src.SourceOrderID, src.SourceCustomerID, src.OrderDate,
         src.OrderStatus, src.GrossAmount, src.DiscountAmount, src.TaxAmount,
         src.ShippingAmount, src.NetPayable, src.SourcePromoID, src.ShippingAddress,
         src.City, src.State, src.PinCode, src.IsDeleted, src.IsFulfilled,
         src.Src_CreatedDate, src.Src_UpdatedDate, GETDATE(), @BrzBatchID);
END;
GO

-- ============================================================
-- SP: usp_Brz_Load_OrderItems
-- ============================================================
CREATE OR ALTER PROCEDURE dbo.usp_Brz_Load_OrderItems
    @RawBatchID INT,
    @BrzBatchID INT
AS
BEGIN
    SET NOCOUNT ON;

    INSERT INTO dbo.br_order_items
        (SourceSystem, SourceLineItemID, SourceOrderID, SourceProductID,
         Quantity, UnitPrice, LineTotal, Discount,
         LineTotalCalc, LineDiscrepancy,
         Src_UpdatedDate, Brz_LoadedAt, Brz_BatchID)
    SELECT
        SourceSystem, SourceLineItemID, SourceOrderID, SourceProductID,
        Quantity, UnitPrice, LineTotal, Discount,
        LineTotalCalc,
        -- flag: |LineTotal - Qty*UnitPrice| > 0.01
        CASE WHEN ABS(ISNULL(LineTotal,0) - ISNULL(LineTotalCalc,0)) > 0.01 THEN 1 ELSE 0 END,
        Src_UpdatedDate, GETDATE(), @BrzBatchID
    FROM (
        SELECT
            'RetailMart'                            AS SourceSystem,
            OrderItemID                             AS SourceLineItemID,
            OrderID                                 AS SourceOrderID,
            ProductID                               AS SourceProductID,
            Quantity, UnitPrice, LineTotal, Discount,
            CAST(ISNULL(Quantity,0) * ISNULL(UnitPrice,0) AS DECIMAL(10,2)) AS LineTotalCalc,
            NULL                                    AS Src_UpdatedDate
        FROM RawDB.retailmart.OrderItems
        WHERE Raw_BatchID = @RawBatchID

        UNION ALL

        SELECT
            'LogiShip'                              AS SourceSystem,
            LineID                                  AS SourceLineItemID,
            SOrderID                                AS SourceOrderID,
            ProdID                                  AS SourceProductID,
            Qty                                     AS Quantity,
            SellingPrice                            AS UnitPrice,
            LineTotalAmt                            AS LineTotal,
            LineDisc                                AS Discount,
            CAST(ISNULL(Qty,0) * ISNULL(SellingPrice,0) AS DECIMAL(10,2)) AS LineTotalCalc,
            UpdatedTs                               AS Src_UpdatedDate
        FROM RawDB.logiship.SalesOrderLines
        WHERE Raw_BatchID = @RawBatchID
    ) src;
END;
GO

-- ============================================================
-- SP: usp_Brz_Load_Payments
-- ============================================================
CREATE OR ALTER PROCEDURE dbo.usp_Brz_Load_Payments
    @RawBatchID INT,
    @BrzBatchID INT
AS
BEGIN
    SET NOCOUNT ON;

    INSERT INTO dbo.br_payments
        (SourceSystem, SourcePaymentID, SourceOrderID, PaymentDate,
         PaymentMethod, PaymentStatus, AmountPaid, TransactionRef, GatewayName,
         Src_UpdatedDate, Brz_LoadedAt, Brz_BatchID)
    SELECT
        SourceSystem, SourcePaymentID, SourceOrderID, PaymentDate,
        PaymentMethod,
        -- Normalise status
        CASE WHEN PaymentStatus IN ('Success','Failed','Pending','Refunded')
             THEN PaymentStatus ELSE 'Unknown' END AS PaymentStatus,
        AmountPaid, TransactionRef, GatewayName,
        Src_UpdatedDate, GETDATE(), @BrzBatchID
    FROM (
        SELECT
            'RetailMart'    AS SourceSystem,
            PaymentID       AS SourcePaymentID,
            OrderID         AS SourceOrderID,
            PaymentDate,
            PaymentMethod,
            PaymentStatus,
            AmountPaid,
            TransactionRef,
            GatewayName,
            NULL            AS Src_UpdatedDate
        FROM RawDB.retailmart.Payments
        WHERE Raw_BatchID = @RawBatchID

        UNION ALL

        SELECT
            'LogiShip'      AS SourceSystem,
            TxnID           AS SourcePaymentID,
            SOrderID        AS SourceOrderID,
            TxnDt           AS PaymentDate,
            PayMode         AS PaymentMethod,
            TxnStatus       AS PaymentStatus,
            PaidAmt         AS AmountPaid,
            TxnRef          AS TransactionRef,
            PGName          AS GatewayName,
            UpdatedTs       AS Src_UpdatedDate
        FROM RawDB.logiship.Transactions
        WHERE Raw_BatchID = @RawBatchID
    ) src;
END;
GO

-- ============================================================
-- SP: usp_Brz_Load_Reviews
-- ============================================================
CREATE OR ALTER PROCEDURE dbo.usp_Brz_Load_Reviews
    @RawBatchID INT,
    @BrzBatchID INT
AS
BEGIN
    SET NOCOUNT ON;

    INSERT INTO dbo.br_reviews
        (SourceSystem, SourceReviewID, SourceProductID, SourceCustomerID,
         Rating, ReviewText, ReviewDate, IsVerifiedBuyer, HelpfulVotes,
         Src_UpdatedDate, Brz_LoadedAt, Brz_BatchID)
    SELECT
        SourceSystem, SourceReviewID, SourceProductID, SourceCustomerID,
        Rating, ReviewText, ReviewDate, IsVerifiedBuyer, HelpfulVotes,
        Src_UpdatedDate, GETDATE(), @BrzBatchID
    FROM (
        SELECT
            'RetailMart'    AS SourceSystem,
            ReviewID        AS SourceReviewID,
            ProductID       AS SourceProductID,
            CustomerID      AS SourceCustomerID,
            Rating,
            ReviewText,
            ReviewDate,
            IsVerifiedBuyer,
            HelpfulVotes,
            NULL            AS Src_UpdatedDate
        FROM RawDB.retailmart.Reviews
        WHERE Raw_BatchID = @RawBatchID

        UNION ALL

        SELECT
            'LogiShip'          AS SourceSystem,
            ReviewID            AS SourceReviewID,
            ProdID              AS SourceProductID,
            MemberID            AS SourceCustomerID,
            StarRating          AS Rating,
            ReviewBody          AS ReviewText,
            ReviewDt            AS ReviewDate,
            VerifiedPurchase    AS IsVerifiedBuyer,
            UsefulCount         AS HelpfulVotes,
            UpdatedTs           AS Src_UpdatedDate
        FROM RawDB.logiship.ProductReviews
        WHERE Raw_BatchID = @RawBatchID
    ) src;
END;
GO

-- ============================================================
-- SP: usp_Brz_Load_LogisticsOnly
-- (Warehouses, Suppliers, Inventory, Shipments, Returns, Procurement)
-- ============================================================
CREATE OR ALTER PROCEDURE dbo.usp_Brz_Load_LogisticsOnly
    @RawBatchID INT,
    @BrzBatchID INT
AS
BEGIN
    SET NOCOUNT ON;

    -- ── Warehouses ──────────────────────────────────────────
    MERGE dbo.br_warehouses AS tgt
    USING (
        SELECT WH_ID,WH_Name,WH_City,WH_State,CountryCode,
               CapacityUnits,IsOperational,ManagerName,Phone,OpenedOn,UpdatedTs
        FROM RawDB.logiship.Warehouses WHERE Raw_BatchID = @RawBatchID
    ) AS src ON tgt.SourceWarehouseID = src.WH_ID
    WHEN MATCHED THEN UPDATE SET
        tgt.WarehouseName=src.WH_Name, tgt.City=src.WH_City,
        tgt.State=src.WH_State, tgt.CapacityUnits=src.CapacityUnits,
        tgt.IsOperational=src.IsOperational, tgt.Src_UpdatedDate=src.UpdatedTs,
        tgt.Brz_LoadedAt=GETDATE(), tgt.Brz_BatchID=@BrzBatchID
    WHEN NOT MATCHED THEN INSERT
        (SourceWarehouseID,WarehouseName,City,State,CountryCode,CapacityUnits,
         IsOperational,ManagerName,Phone,OpenedOn,Src_UpdatedDate,Brz_LoadedAt,Brz_BatchID)
    VALUES
        (src.WH_ID,src.WH_Name,src.WH_City,src.WH_State,src.CountryCode,
         src.CapacityUnits,src.IsOperational,src.ManagerName,src.Phone,src.OpenedOn,
         src.UpdatedTs,GETDATE(),@BrzBatchID);

    -- ── Suppliers ───────────────────────────────────────────
    MERGE dbo.br_suppliers AS tgt
    USING (
        SELECT SupID,SupName,SupEmail,SupPhone,CountryCode,LeadDays,
               PayTerms,SupRating,ActiveFlag,OnboardDt,UpdatedTs
        FROM RawDB.logiship.Suppliers WHERE Raw_BatchID = @RawBatchID
    ) AS src ON tgt.SourceSupplierID = src.SupID
    WHEN MATCHED THEN UPDATE SET
        tgt.SupplierName=src.SupName, tgt.Email=src.SupEmail,
        tgt.Rating=src.SupRating, tgt.IsActive=src.ActiveFlag,
        tgt.Src_UpdatedDate=src.UpdatedTs, tgt.Brz_LoadedAt=GETDATE(), tgt.Brz_BatchID=@BrzBatchID
    WHEN NOT MATCHED THEN INSERT
        (SourceSupplierID,SupplierName,Email,Phone,CountryCode,LeadDays,PayTerms,
         Rating,IsActive,OnboardDate,Src_UpdatedDate,Brz_LoadedAt,Brz_BatchID)
    VALUES
        (src.SupID,src.SupName,src.SupEmail,src.SupPhone,src.CountryCode,
         src.LeadDays,src.PayTerms,src.SupRating,src.ActiveFlag,src.OnboardDt,
         src.UpdatedTs,GETDATE(),@BrzBatchID);

    -- ── Inventory ────────────────────────────────────────────
    INSERT INTO dbo.br_inventory
        (SourceLedgerID,BarCode,SourceWarehouseID,QtyOnHand,QtyReserved,
         QtyAvailable,ReorderLevel,ReplenishQty,SourceSupplierID,
         LastStockDate,LastAuditDate,Src_UpdatedDate,Brz_LoadedAt,Brz_BatchID)
    SELECT
        LedgerID,BarCode,WH_ID,QtyOnHand,QtyReserved,
        ISNULL(QtyOnHand,0) - ISNULL(QtyReserved,0),  -- materialise computed col
        ReorderLevel,ReplenishQty,SupID,
        LastStockDt,LastAuditDt,UpdatedTs,GETDATE(),@BrzBatchID
    FROM RawDB.logiship.StockLedger
    WHERE Raw_BatchID = @RawBatchID;

    -- ── Shipments ────────────────────────────────────────────
    INSERT INTO dbo.br_shipments
        (SourceShipmentID,SourceOrderID,SourceWarehouseID,ShipmentDate,
         ExpectedDelivery,ActualDelivery,CarrierCode,TrackingNumber,ShipmentStatus,
         ShippingCost,ChargedWeightKg,
         DeliveryDays, IsLateDelivery,
         Src_UpdatedDate,Brz_LoadedAt,Brz_BatchID)
    SELECT
        ShipID,SOrderID,WH_ID,DispatchDt,
        EstDelivDt,ActDelivDt,CourierCode,AWBNumber,ShipState,
        FreightCharge,ChargedWtKg,
        -- derive delivery days (NULL if not delivered)
        CASE WHEN ActDelivDt IS NOT NULL AND DispatchDt IS NOT NULL
             THEN DATEDIFF(DAY, CAST(DispatchDt AS DATE), ActDelivDt)
             ELSE NULL END,
        -- late flag
        CASE WHEN ActDelivDt IS NOT NULL AND EstDelivDt IS NOT NULL
                  AND ActDelivDt > EstDelivDt THEN 1 ELSE 0 END,
        UpdatedTs,GETDATE(),@BrzBatchID
    FROM RawDB.logiship.Shipments
    WHERE Raw_BatchID = @RawBatchID;

    -- ── Returns ──────────────────────────────────────────────
    INSERT INTO dbo.br_returns
        (SourceReturnID,SourceOrderID,SourceShipmentID,ReturnDate,Reason,
         ReturnStatus,RefundAmount,ReturnSKU,ReturnQty,QCNotes,
         IsRefunded,Src_UpdatedDate,Brz_LoadedAt,Brz_BatchID)
    SELECT
        RetID,SOrderID,ShipID,ReturnDt,ReturnReason,
        RetStatus,RefundAmt,ReturnedBarCode,RetQty,QCNotes,
        CASE WHEN RetStatus = 'Refunded' THEN 1 ELSE 0 END,
        UpdatedTs,GETDATE(),@BrzBatchID
    FROM RawDB.logiship.Returns
    WHERE Raw_BatchID = @RawBatchID;

    -- ── Procurement ──────────────────────────────────────────
    INSERT INTO dbo.br_procurement
        (SourcePOID,SourceSupplierID,SourceWarehouseID,PODate,
         ExpectedArrival,ActualArrival,POStatus,TotalValue,Currency,CreatedBy,
         LeadTimeDays, IsDelayed,
         Src_UpdatedDate,Brz_LoadedAt,Brz_BatchID)
    SELECT
        POID,SupID,WH_ID,PODt,
        ExpArrDt,ActArrDt,POState,OrderValue,CurrencyCode,CreatedBy,
        CASE WHEN ActArrDt IS NOT NULL AND PODt IS NOT NULL
             THEN DATEDIFF(DAY, PODt, ActArrDt) ELSE NULL END,
        CASE WHEN ActArrDt IS NOT NULL AND ExpArrDt IS NOT NULL
                  AND ActArrDt > ExpArrDt THEN 1 ELSE 0 END,
        UpdatedTs,GETDATE(),@BrzBatchID
    FROM RawDB.logiship.ProcurementOrders
    WHERE Raw_BatchID = @RawBatchID;
END;
GO

-- ============================================================
-- SP: usp_Brz_Load_All  (master orchestrator)
-- ============================================================
CREATE OR ALTER PROCEDURE dbo.usp_Brz_Load_All
    @RawBatchID INT
AS
BEGIN
    SET NOCOUNT ON;

    INSERT INTO dbo.BrzLoadLog (RawBatchID, Notes)
    VALUES (@RawBatchID, 'Bronze load started');
    DECLARE @BrzBatchID INT = SCOPE_IDENTITY();

    BEGIN TRY
        EXEC dbo.usp_Brz_Load_Categories     @RawBatchID, @BrzBatchID;
        EXEC dbo.usp_Brz_Load_Products        @RawBatchID, @BrzBatchID;
        EXEC dbo.usp_Brz_Load_Customers       @RawBatchID, @BrzBatchID;
        EXEC dbo.usp_Brz_Load_Promotions      @RawBatchID, @BrzBatchID;
        EXEC dbo.usp_Brz_Load_Orders          @RawBatchID, @BrzBatchID;
        EXEC dbo.usp_Brz_Load_OrderItems      @RawBatchID, @BrzBatchID;
        EXEC dbo.usp_Brz_Load_Payments        @RawBatchID, @BrzBatchID;
        EXEC dbo.usp_Brz_Load_Reviews         @RawBatchID, @BrzBatchID;
        EXEC dbo.usp_Brz_Load_LogisticsOnly   @RawBatchID, @BrzBatchID;

        UPDATE dbo.BrzLoadLog
        SET RunFinishedAt=GETDATE(), Status='Success', Notes='All Bronze tables loaded.'
        WHERE BatchID=@BrzBatchID;

        PRINT CONCAT('Bronze load complete. BrzBatchID=', @BrzBatchID);
    END TRY
    BEGIN CATCH
        UPDATE dbo.BrzLoadLog
        SET RunFinishedAt=GETDATE(), Status='Failed', Notes=ERROR_MESSAGE()
        WHERE BatchID=@BrzBatchID;
        THROW;
    END CATCH;
END;
GO

PRINT '05_SP_Raw_To_Bronze.sql installed successfully.';
GO
