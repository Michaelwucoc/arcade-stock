import { Context, Schema } from 'koishi';
export declare const name = "stock-manager";
export declare const inject: string[];
export interface StockItem {
    name: string;
    aliases: string[];
    count: number;
    totalAdded: number;
    totalConsumed: number;
}
export interface StockRecord {
    id: number;
    itemName: string;
    userId: string;
    userName: string;
    change: number;
    timestamp: number;
    isRanked: boolean;
}
export interface Config {
    whitelistGroups: string[];
    getCodeTag: string;
    items: Array<{
        name: string;
        aliases: string[];
    }>;
    queryMessages: string[];
    defaultQueryMessage: string;
}
export declare const Config: Schema<Config>;
export declare function apply(ctx: Context, config: Config): void;
//# sourceMappingURL=index.d.ts.map