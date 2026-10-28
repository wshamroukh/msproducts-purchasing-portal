/* =====================================================================
   Sample data - stores and Microsoft products.
   Prices are illustrative internal list prices (USD) for demo only.
   Idempotent: rows are only inserted when the SKU / store name is new.
   ===================================================================== */

INSERT INTO dbo.Stores (Name, City, Country, Email, Phone)
SELECT s.Name, s.City, s.Country, s.Email, s.Phone
FROM (VALUES
    (N'Muscat Fulfilment Center', N'Muscat',    N'Oman',                 N'muscat.store@contoso.example',    N'+968 2400 0000'),
    (N'Dubai Distribution Hub',   N'Dubai',     N'United Arab Emirates', N'dubai.store@contoso.example',     N'+971 4 000 0000'),
    (N'Riyadh Warehouse',         N'Riyadh',    N'Saudi Arabia',         N'riyadh.store@contoso.example',    N'+966 11 000 0000'),
    (N'Redmond Campus Store',     N'Redmond',   N'United States',        N'redmond.store@contoso.example',   N'+1 425 000 0000'),
    (N'Dublin EMEA Logistics',    N'Dublin',    N'Ireland',              N'dublin.store@contoso.example',    N'+353 1 000 0000')
) AS s(Name, City, Country, Email, Phone)
WHERE NOT EXISTS (SELECT 1 FROM dbo.Stores x WHERE x.Name = s.Name);
GO

INSERT INTO dbo.Products (Sku, Name, Category, Description, Price, Stock)
SELECT p.Sku, p.Name, p.Category, p.Description, p.Price, p.Stock
FROM (VALUES
    -- ---------------- Software ----------------
    (N'SW-WIN11-ENT',   N'Windows 11 Enterprise E3',            N'Software', N'Per-user annual subscription. Advanced security, Windows Autopatch and Universal Print.',              84.00,  9999),
    (N'SW-M365-E3',     N'Microsoft 365 E3',                    N'Software', N'Office apps, Exchange, SharePoint, Teams and Windows Enterprise with Intune - per user / year.',       432.00, 9999),
    (N'SW-M365-E5',     N'Microsoft 365 E5',                    N'Software', N'Everything in E3 plus advanced security, compliance and Power BI Pro - per user / year.',             684.00, 9999),
    (N'SW-M365-COPILOT',N'Microsoft 365 Copilot',               N'Software', N'AI assistant across Word, Excel, PowerPoint, Outlook and Teams - per user / year add-on.',            360.00, 9999),
    (N'SW-OFFICE-2024', N'Office LTSC Professional Plus 2024',  N'Software', N'Perpetual device license for Word, Excel, PowerPoint, Outlook and Access.',                           499.00, 9999),
    (N'SW-VISIO-P2',    N'Visio Plan 2',                        N'Software', N'Professional diagramming with desktop app - per user / year.',                                        180.00, 9999),
    (N'SW-PROJECT-P3',  N'Project Plan 3',                      N'Software', N'Project and portfolio management with desktop client - per user / year.',                             360.00, 9999),
    (N'SW-VS-ENT',      N'Visual Studio Enterprise Subscription',N'Software', N'Visual Studio Enterprise IDE with Azure credits and dev/test benefits - annual.',                     2999.00, 9999),
    (N'SW-TEAMS-PREM',  N'Microsoft Teams Premium',             N'Software', N'Intelligent recap, advanced webinars and meeting protection - per user / year.',                     120.00, 9999),
    (N'SW-WINSRV-2025', N'Windows Server 2025 Standard (16-core)',N'Software', N'Server operating system license pack covering 16 cores.',                                          1176.00, 500),
    (N'SW-SQL-2022-STD',N'SQL Server 2022 Standard (2-core)',   N'Software', N'Per-core license pack for SQL Server 2022 Standard edition.',                                        3945.00, 500),
    -- ---------------- Hardware ----------------
    (N'HW-SL7-13',      N'Surface Laptop 7th Edition 13.8"',    N'Hardware', N'Copilot+ PC, Snapdragon X Elite, 16 GB RAM, 512 GB SSD, PixelSense touchscreen.',                    1399.00, 120),
    (N'HW-SL7-15',      N'Surface Laptop 7th Edition 15"',      N'Hardware', N'Copilot+ PC, Snapdragon X Elite, 32 GB RAM, 1 TB SSD, 15" PixelSense Flow display.',                 1999.00, 60),
    (N'HW-SP11',        N'Surface Pro 11th Edition',            N'Hardware', N'Copilot+ 2-in-1, Snapdragon X Plus, 16 GB RAM, 512 GB SSD, OLED option.',                            1299.00, 90),
    (N'HW-SLS2',        N'Surface Laptop Studio 2',             N'Hardware', N'Intel Core i7, NVIDIA RTX 4050, 32 GB RAM, 1 TB SSD - for developers and creators.',                 2699.00, 25),
    (N'HW-SGO4',        N'Surface Go 4 for Business',           N'Hardware', N'Compact 10.5" tablet, Intel N200, 8 GB RAM, 128 GB storage - ideal for frontline workers.',           579.00, 80),
    (N'HW-HUB3-50',     N'Surface Hub 3 50"',                   N'Hardware', N'Collaboration board for Microsoft Teams Rooms with rotating display.',                               9999.00, 5),
    (N'HW-XBOX-SX',     N'Xbox Series X',                       N'Hardware', N'1 TB console for break-room and team-building spaces.',                                              499.00, 15),
    -- ---------------- Accessories ----------------
    (N'AC-ARC-MOUSE',   N'Surface Arc Mouse',                   N'Accessories', N'Slim, foldable Bluetooth mouse that snaps flat for travel.',                                       79.99,  300),
    (N'AC-BT-MOUSE',    N'Microsoft Bluetooth Mouse',           N'Accessories', N'Ambidextrous Bluetooth mouse with up to 12 months battery life.',                                  24.99,  500),
    (N'AC-ERGO-KB',     N'Microsoft Ergonomic Keyboard',        N'Accessories', N'Split ergonomic design with cushioned palm rest and dedicated Office key.',                        59.99,  200),
    (N'AC-SURF-KB',     N'Surface Keyboard',                    N'Accessories', N'Minimalist Bluetooth keyboard with full-size keys and number pad.',                                 99.99,  150),
    (N'AC-SP-FLEX-KB',  N'Surface Pro Flex Keyboard',           N'Accessories', N'Detachable keyboard with haptic touchpad and Slim Pen storage for Surface Pro.',                    349.99, 120),
    (N'AC-SLIM-PEN2',   N'Surface Slim Pen 2',                  N'Accessories', N'Rechargeable pen with haptic feedback for natural writing and drawing.',                           129.99, 200),
    (N'AC-TB4-DOCK',    N'Surface Thunderbolt 4 Dock',          N'Accessories', N'Single-cable dock with dual 4K display support, 2.5 GbE and 96 W charging.',                       299.99, 100),
    (N'AC-HEADPH2',     N'Surface Headphones 2+',               N'Accessories', N'Certified for Microsoft Teams with adjustable noise cancellation.',                                 299.99, 80),
    (N'AC-USBC-SPK',    N'Microsoft Modern USB-C Speaker',      N'Accessories', N'Teams-certified compact speakerphone with Teams button.',                                          99.99,  150),
    (N'AC-WEBCAM',      N'Microsoft Modern Webcam',             N'Accessories', N'1080p HDR webcam with privacy shutter, certified for Teams.',                                       69.99,  250),
    (N'AC-65W-PSU',     N'Surface 65W Power Supply',            N'Accessories', N'Spare charger for Surface Laptop and Surface Pro.',                                                 79.99,  200)
) AS p(Sku, Name, Category, Description, Price, Stock)
WHERE NOT EXISTS (SELECT 1 FROM dbo.Products x WHERE x.Sku = p.Sku);
GO
