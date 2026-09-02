export declare function fetchAndStoreCurrencyRates(prisma: import("@prisma/client").PrismaClient): Promise<{
    pairsRequested: number;
    ratesStored: number;
    rateDate: Date;
}>;
