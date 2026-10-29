/* =====================================================================
   Microsoft Products Purchasing Portal - database schema
   Idempotent: safe to run many times.  Batches are separated by GO.
   ===================================================================== */

IF OBJECT_ID('dbo.Stores', 'U') IS NULL
CREATE TABLE dbo.Stores (
    StoreId      INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Stores PRIMARY KEY,
    Name         NVARCHAR(100)  NOT NULL,
    City         NVARCHAR(100)  NOT NULL,
    Country      NVARCHAR(100)  NOT NULL,
    Email        NVARCHAR(256)  NULL,
    Phone        NVARCHAR(50)   NULL,
    IsActive     BIT            NOT NULL CONSTRAINT DF_Stores_IsActive DEFAULT (1),
    CreatedAt    DATETIME2(0)   NOT NULL CONSTRAINT DF_Stores_CreatedAt DEFAULT (SYSUTCDATETIME())
);
GO

IF OBJECT_ID('dbo.Products', 'U') IS NULL
CREATE TABLE dbo.Products (
    ProductId    INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Products PRIMARY KEY,
    Sku          NVARCHAR(50)   NOT NULL CONSTRAINT UQ_Products_Sku UNIQUE,
    Name         NVARCHAR(200)  NOT NULL,
    Category     NVARCHAR(50)   NOT NULL,   -- Software | Hardware | Accessories
    Description  NVARCHAR(2000) NULL,
    Price        DECIMAL(10,2)  NOT NULL CONSTRAINT CK_Products_Price CHECK (Price >= 0),
    ImageUrl     NVARCHAR(500)  NULL,
    Stock        INT            NOT NULL CONSTRAINT DF_Products_Stock DEFAULT (0) CONSTRAINT CK_Products_Stock CHECK (Stock >= 0),
    IsActive     BIT            NOT NULL CONSTRAINT DF_Products_IsActive DEFAULT (1),
    CreatedAt    DATETIME2(0)   NOT NULL CONSTRAINT DF_Products_CreatedAt DEFAULT (SYSUTCDATETIME()),
    UpdatedAt    DATETIME2(0)   NOT NULL CONSTRAINT DF_Products_UpdatedAt DEFAULT (SYSUTCDATETIME())
);
GO

IF OBJECT_ID('dbo.Orders', 'U') IS NULL
CREATE TABLE dbo.Orders (
    OrderId        INT IDENTITY(1000,1) NOT NULL CONSTRAINT PK_Orders PRIMARY KEY,
    OrderNumber    AS ('ORD-' + RIGHT('000000' + CAST(OrderId AS VARCHAR(10)), 6)) PERSISTED,
    UserOid        NVARCHAR(64)   NOT NULL,
    UserName       NVARCHAR(200)  NOT NULL,
    UserEmail      NVARCHAR(256)  NULL,
    ShipToName     NVARCHAR(200)  NOT NULL,
    ShipToAddress  NVARCHAR(500)  NOT NULL,
    ShipToCity     NVARCHAR(100)  NOT NULL,
    ShipToCountry  NVARCHAR(100)  NOT NULL,
    Phone          NVARCHAR(50)   NULL,
    CostCenter     NVARCHAR(50)   NOT NULL,
    Justification  NVARCHAR(1000) NULL,
    Status         NVARCHAR(30)   NOT NULL CONSTRAINT DF_Orders_Status DEFAULT ('Submitted'),
    StoreId        INT            NULL CONSTRAINT FK_Orders_Stores REFERENCES dbo.Stores(StoreId),
    TrackingNumber NVARCHAR(100)  NULL,
    Total          DECIMAL(12,2)  NOT NULL,
    CreatedAt      DATETIME2(0)   NOT NULL CONSTRAINT DF_Orders_CreatedAt DEFAULT (SYSUTCDATETIME()),
    UpdatedAt      DATETIME2(0)   NOT NULL CONSTRAINT DF_Orders_UpdatedAt DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT CK_Orders_Status CHECK (Status IN ('Submitted','Processing','SentToStore','Delivered','Cancelled'))
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Orders_UserOid')
    CREATE INDEX IX_Orders_UserOid ON dbo.Orders (UserOid, CreatedAt DESC);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Orders_Status')
    CREATE INDEX IX_Orders_Status ON dbo.Orders (Status, CreatedAt DESC);
GO

IF OBJECT_ID('dbo.OrderItems', 'U') IS NULL
CREATE TABLE dbo.OrderItems (
    OrderItemId  INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_OrderItems PRIMARY KEY,
    OrderId      INT            NOT NULL CONSTRAINT FK_OrderItems_Orders REFERENCES dbo.Orders(OrderId) ON DELETE CASCADE,
    ProductId    INT            NOT NULL CONSTRAINT FK_OrderItems_Products REFERENCES dbo.Products(ProductId),
    Sku          NVARCHAR(50)   NOT NULL,
    ProductName  NVARCHAR(200)  NOT NULL,
    UnitPrice    DECIMAL(10,2)  NOT NULL,
    Quantity     INT            NOT NULL CONSTRAINT CK_OrderItems_Qty CHECK (Quantity > 0)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_OrderItems_OrderId')
    CREATE INDEX IX_OrderItems_OrderId ON dbo.OrderItems (OrderId);
GO

IF OBJECT_ID('dbo.OrderHistory', 'U') IS NULL
CREATE TABLE dbo.OrderHistory (
    HistoryId    INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_OrderHistory PRIMARY KEY,
    OrderId      INT            NOT NULL CONSTRAINT FK_OrderHistory_Orders REFERENCES dbo.Orders(OrderId) ON DELETE CASCADE,
    Status       NVARCHAR(30)   NOT NULL,
    Note         NVARCHAR(1000) NULL,
    ChangedBy    NVARCHAR(256)  NOT NULL,
    ChangedAt    DATETIME2(0)   NOT NULL CONSTRAINT DF_OrderHistory_ChangedAt DEFAULT (SYSUTCDATETIME())
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_OrderHistory_OrderId')
    CREATE INDEX IX_OrderHistory_OrderId ON dbo.OrderHistory (OrderId, ChangedAt);
GO

-- Admin order board: latest orders first
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Orders_CreatedAt')
    CREATE INDEX IX_Orders_CreatedAt ON dbo.Orders (CreatedAt DESC, OrderId DESC) INCLUDE (Status);
GO
