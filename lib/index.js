"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.Config = exports.inject = exports.name = void 0;
exports.apply = apply;
const koishi_1 = require("koishi");
const fs_1 = require("fs");
const path_1 = require("path");
const yaml = __importStar(require("yaml"));
const crypto_1 = require("crypto");
exports.name = 'stock-manager';
// 不再需要数据库依赖
exports.inject = [];
exports.Config = koishi_1.Schema.object({
    whitelistGroups: koishi_1.Schema.array(koishi_1.Schema.string()).description('白名单群组ID列表').default([]),
    getCodeTag: koishi_1.Schema.string()
        .description('每次修改库存后追加的校验码标识（不含冒号），最终输出为 `${getCodeTag}: 时间戳_QQ号_物品名_随机十六进制数字6位`')
        .default('wmc_ref'),
    items: koishi_1.Schema.array(koishi_1.Schema.object({
        name: koishi_1.Schema.string().required().description('物品名称'),
        aliases: koishi_1.Schema.array(koishi_1.Schema.string()).required().description('别名列表')
    })).description('物品配置').default([
        { name: '纯净水', aliases: ['water', '水', '纯净水'] }
    ]),
    queryMessages: koishi_1.Schema.array(koishi_1.Schema.string()).description('查询消息模板列表').default(['{name}有多少', '{name}几', '{name}j']),
    defaultQueryMessage: koishi_1.Schema.string().description('默认查询回复模板').default('{name}当前库存：{count}瓶\n累计添加：{totalAdded}瓶\n累计消耗：{totalConsumed}瓶\n最近操作：{recentRecords}')
});
function apply(ctx, config) {
    function createGetCode(params) {
        const rand6 = (0, crypto_1.randomBytes)(3).toString('hex'); // 6位十六进制
        const tag = (config.getCodeTag || 'wmc_ref').trim().replace(/:$/, '') || 'wmc_ref';
        return `${tag}: ${params.timestamp}_${params.userId}_${params.itemName}_${rand6}`;
    }
    // 数据文件路径
    const dataDir = (0, path_1.join)(ctx.baseDir, 'data', 'stock-manager');
    const itemsFile = (0, path_1.join)(dataDir, 'items.yml');
    const recordsFile = (0, path_1.join)(dataDir, 'records.yml');
    // 存储库存数据（内存缓存，从文件同步）
    const stockData = new Map();
    let nextRecordId = 1;
    // 确保数据目录存在
    async function ensureDataDir() {
        try {
            await fs_1.promises.mkdir(dataDir, { recursive: true });
        }
        catch (err) {
            ctx.logger('stock-manager').error('创建数据目录失败:', err);
            throw err;
        }
    }
    // 加载库存数据
    async function loadStockData() {
        try {
            await ensureDataDir();
            const content = await fs_1.promises.readFile(itemsFile, 'utf-8').catch(() => '');
            if (!content.trim()) {
                // 文件不存在或为空，初始化数据
                for (const item of config.items) {
                    stockData.set(item.name, {
                        name: item.name,
                        aliases: item.aliases,
                        count: 0,
                        totalAdded: 0,
                        totalConsumed: 0
                    });
                }
                await saveStockData();
                return;
            }
            const data = yaml.parse(content) || {};
            stockData.clear();
            // 加载文件中的数据，但保留配置中的最新别名
            for (const item of config.items) {
                const savedItem = data[item.name];
                if (savedItem) {
                    stockData.set(item.name, {
                        ...savedItem,
                        aliases: item.aliases // 使用配置中的最新别名
                    });
                }
                else {
                    stockData.set(item.name, {
                        name: item.name,
                        aliases: item.aliases,
                        count: 0,
                        totalAdded: 0,
                        totalConsumed: 0
                    });
                }
            }
            ctx.logger('stock-manager').info(`成功加载 ${stockData.size} 个物品的数据`);
        }
        catch (err) {
            ctx.logger('stock-manager').error('加载库存数据失败:', err);
            // 如果加载失败，至少确保内存中有数据
            for (const item of config.items) {
                if (!stockData.has(item.name)) {
                    stockData.set(item.name, {
                        name: item.name,
                        aliases: item.aliases,
                        count: 0,
                        totalAdded: 0,
                        totalConsumed: 0
                    });
                }
            }
        }
    }
    // 保存库存数据
    async function saveStockData() {
        try {
            await ensureDataDir();
            const data = {};
            stockData.forEach((item, name) => {
                data[name] = item;
            });
            const content = yaml.stringify(data, {
                indent: 2,
                lineWidth: 0,
                defaultStringType: 'QUOTE_DOUBLE'
            });
            await fs_1.promises.writeFile(itemsFile, content, 'utf-8');
            ctx.logger('stock-manager').debug('已保存库存数据');
        }
        catch (err) {
            ctx.logger('stock-manager').error('保存库存数据失败:', err);
            throw err;
        }
    }
    // 保存单个物品（延迟保存，避免频繁写文件）
    let saveTimer = null;
    async function saveStockItem(item) {
        stockData.set(item.name, item);
        // 防抖：500ms 内多次保存只执行一次
        if (saveTimer) {
            clearTimeout(saveTimer);
        }
        saveTimer = setTimeout(async () => {
            await saveStockData();
            saveTimer = null;
        }, 500);
    }
    // 加载操作记录
    async function loadRecords() {
        try {
            await ensureDataDir();
            const content = await fs_1.promises.readFile(recordsFile, 'utf-8').catch(() => '');
            if (!content.trim()) {
                return [];
            }
            const records = yaml.parse(content) || [];
            // 更新 nextRecordId
            if (records.length > 0) {
                nextRecordId = Math.max(...records.map(r => r.id || 0)) + 1;
            }
            return records;
        }
        catch (err) {
            ctx.logger('stock-manager').error('加载操作记录失败:', err);
            return [];
        }
    }
    // 保存操作记录
    async function saveRecords(records) {
        try {
            await ensureDataDir();
            // 只保留最近100条记录
            const recentRecords = records
                .sort((a, b) => b.timestamp - a.timestamp)
                .slice(0, 100)
                .reverse(); // 按时间顺序存储
            const content = yaml.stringify(recentRecords, {
                indent: 2,
                lineWidth: 0,
                defaultStringType: 'QUOTE_DOUBLE'
            });
            await fs_1.promises.writeFile(recordsFile, content, 'utf-8');
            ctx.logger('stock-manager').debug(`已保存 ${recentRecords.length} 条操作记录`);
        }
        catch (err) {
            ctx.logger('stock-manager').error('保存操作记录失败:', err);
            throw err;
        }
    }
    // 添加操作记录
    let recordsCache = null;
    let recordsTimer = null;
    async function addRecord(record) {
        if (!recordsCache) {
            recordsCache = await loadRecords();
        }
        record.id = nextRecordId++;
        recordsCache.push(record);
        // 防抖保存
        if (recordsTimer) {
            clearTimeout(recordsTimer);
        }
        recordsTimer = setTimeout(async () => {
            if (recordsCache) {
                await saveRecords(recordsCache);
            }
            recordsTimer = null;
        }, 500);
    }
    // 获取操作记录
    async function getRecords() {
        if (!recordsCache) {
            recordsCache = await loadRecords();
        }
        return recordsCache;
    }
    // 创建别名映射
    const aliasMap = new Map();
    config.items.forEach(item => {
        item.aliases.forEach(alias => {
            aliasMap.set(alias.toLowerCase(), item.name);
        });
    });
    // 初始化数据
    let initialized = false;
    let initPromise = null;
    async function ensureInitialized() {
        if (initialized)
            return;
        if (initPromise)
            return initPromise;
        initPromise = (async () => {
            try {
                await loadStockData();
                await loadRecords(); // 预加载记录
                ctx.logger('stock-manager').info('数据初始化完成');
                initialized = true;
            }
            catch (err) {
                ctx.logger('stock-manager').error('初始化失败:', err);
                initialized = true; // 即使失败也标记为已初始化，使用内存存储
            }
        })();
        return initPromise;
    }
    // 立即初始化
    ensureInitialized().catch(err => {
        ctx.logger('stock-manager').error('初始化失败:', err);
    });
    // 检查是否在白名单中
    function isWhitelisted(groupId) {
        if (config.whitelistGroups.length === 0)
            return true;
        return config.whitelistGroups.includes(groupId);
    }
    // 根据别名获取物品名称
    function getItemName(alias) {
        return aliasMap.get(alias.toLowerCase()) || null;
    }
    // 解析操作（支持 water-1, water+1, water=10, water-1-r 格式）
    function parseOperation(text) {
        // 检查是否有 -r 参数（支持 water-1-r 或 water-r-1 等格式）
        const noRank = /\b-r\b/.test(text);
        const cleanText = text.replace(/\b-r\b/g, '').trim();
        // 匹配格式：别名+数字、别名-数字、别名=数字
        const match = cleanText.match(/^(.+?)([+\-=])(\d+)$/);
        if (!match)
            return null;
        const [, alias, op, valueStr] = match;
        const itemName = getItemName(alias.trim());
        if (!itemName)
            return null;
        const value = parseInt(valueStr, 10);
        if (isNaN(value))
            return null;
        return {
            itemName,
            operation: op,
            value,
            noRank
        };
    }
    // 处理操作
    async function handleOperation(session, op) {
        await ensureInitialized();
        const item = stockData.get(op.itemName);
        if (!item) {
            ctx.logger('stock-manager').warn(`物品 ${op.itemName} 不存在于 stockData 中`);
            await session.send(`错误：物品 ${op.itemName} 不存在`);
            return;
        }
        let change = 0;
        let actualOp = '+';
        if (op.operation === '+') {
            change = op.value;
            actualOp = '+';
            item.count += op.value;
            if (!op.noRank) {
                item.totalAdded += op.value;
            }
        }
        else if (op.operation === '-') {
            change = -op.value;
            actualOp = '-';
            item.count -= op.value;
            if (item.count < 0)
                item.count = 0;
            if (!op.noRank) {
                item.totalConsumed += op.value;
            }
        }
        else if (op.operation === '=') {
            const diff = op.value - item.count;
            change = diff;
            if (diff > 0) {
                actualOp = '+';
                item.count = op.value;
                if (!op.noRank) {
                    item.totalAdded += diff;
                }
            }
            else if (diff < 0) {
                actualOp = '-';
                item.count = op.value;
                if (!op.noRank) {
                    item.totalConsumed += Math.abs(diff);
                }
            }
            else {
                // diff === 0，库存不变，不记录操作
                await session.send(`${op.itemName} 库存未变化，当前库存：${item.count}瓶`);
                return;
            }
        }
        // 保存库存数据
        try {
            await saveStockItem(item);
            // 记录操作
            const opTimestamp = Date.now();
            const record = {
                id: 0, // 会在 addRecord 中设置
                itemName: op.itemName,
                userId: session.userId || 'unknown',
                userName: session.author?.nickname || session.username || '未知用户',
                change,
                timestamp: opTimestamp,
                isRanked: !op.noRank
            };
            await addRecord(record);
            const changeText = actualOp === '+' ? `+${Math.abs(change)}` : `-${Math.abs(change)}`;
            const getCode = createGetCode({ timestamp: opTimestamp, userId: record.userId, itemName: op.itemName });
            // 如果计入了排行榜，显示排行榜更新
            if (!op.noRank) {
                const rankingType = actualOp === '+' ? 'add' : 'consume';
                const ranking = await getRanking(op.itemName, rankingType);
                const rankingTitle = actualOp === '+' ? '累计排行榜' : '消耗排行榜';
                await session.send(`${op.itemName} ${changeText}，当前库存：${item.count}瓶\n\n${op.itemName}${rankingTitle}：\n${ranking}\n\n${getCode}`);
            }
            else {
                // 不计入排行榜，只显示库存变化
                await session.send(`${op.itemName} ${changeText}，当前库存：${item.count}瓶（不计入排行榜）\n\n${getCode}`);
            }
        }
        catch (err) {
            ctx.logger('stock-manager').error('保存操作失败:', err);
            await session.send(`操作失败：${op.itemName} 数据保存出错，请稍后重试`);
        }
    }
    // 检查查询消息
    function isQueryMessage(text) {
        for (const template of config.queryMessages) {
            // 使用临时标记替换 {name}，转义其他字符后再恢复
            const tempMarker = '__NAME_PLACEHOLDER__';
            const pattern = template
                .replace(/\{name\}/g, tempMarker)
                .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
                .replace(new RegExp(tempMarker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '(.+?)');
            const regex = new RegExp(`^${pattern}$`, 'i');
            const match = text.match(regex);
            if (match) {
                const alias = match[1];
                const itemName = getItemName(alias);
                if (itemName) {
                    return { itemName };
                }
            }
        }
        return null;
    }
    // 处理查询
    async function handleQuery(session, itemName) {
        await ensureInitialized();
        const item = stockData.get(itemName);
        if (!item)
            return;
        // 从记录中获取最近5条记录
        const allRecords = await getRecords();
        const recentRecords = allRecords
            .filter(r => r.itemName === itemName)
            .sort((a, b) => b.timestamp - a.timestamp)
            .slice(0, 5)
            .reverse()
            .map(r => `${r.userName} ${r.change > 0 ? '+' : ''}${r.change}`)
            .join('\n');
        const message = config.defaultQueryMessage
            .replace(/\{name\}/g, itemName)
            .replace(/\{count\}/g, item.count.toString())
            .replace(/\{totalAdded\}/g, item.totalAdded.toString())
            .replace(/\{totalConsumed\}/g, item.totalConsumed.toString())
            .replace(/\{recentRecords\}/g, recentRecords || '暂无记录');
        await session.send(message);
    }
    // 获取排行榜
    async function getRanking(itemName, type) {
        const item = stockData.get(itemName);
        if (!item)
            return '';
        // 从记录中获取所有相关记录
        const allRecords = await getRecords();
        const relevantRecords = allRecords.filter(r => r.itemName === itemName && r.isRanked);
        const userStats = new Map();
        relevantRecords.forEach(r => {
            if (type === 'consume' && r.change < 0) {
                const key = r.userId;
                const current = userStats.get(key) || { name: r.userName, count: 0 };
                current.count += Math.abs(r.change);
                userStats.set(key, current);
            }
            else if (type === 'add' && r.change > 0) {
                const key = r.userId;
                const current = userStats.get(key) || { name: r.userName, count: 0 };
                current.count += r.change;
                userStats.set(key, current);
            }
        });
        const sorted = Array.from(userStats.values())
            .sort((a, b) => b.count - a.count)
            .slice(0, 10);
        if (sorted.length === 0) {
            return type === 'consume' ? '暂无消耗记录' : '暂无添加记录';
        }
        return sorted
            .map((stat, index) => `${index + 1}. ${stat.name}: ${stat.count}瓶`)
            .join('\n');
    }
    // 监听所有消息
    ctx.on('message', async (session) => {
        // 只处理群消息
        if (!session.channelId || session.channelId === session.userId)
            return;
        // 检查白名单
        if (!isWhitelisted(session.channelId))
            return;
        // 等待初始化完成
        await ensureInitialized();
        const text = (session.content || '').trim();
        if (!text)
            return;
        // 尝试解析操作
        const operation = parseOperation(text);
        if (operation) {
            await handleOperation(session, operation);
            return;
        }
        // 尝试解析查询
        const query = isQueryMessage(text);
        if (query) {
            await handleQuery(session, query.itemName);
            return;
        }
    });
    // 注册隐藏的管理指令（用于设置库存等）
    const stockCmd = ctx.command('stock', '库存管理');
    if ('hidden' in stockCmd) {
        stockCmd.hidden = true;
    }
    stockCmd
        .subcommand('.set <item:string> <count:number>', '设置库存数量')
        .action(async ({ session }, item, count) => {
        if (!session || !session.channelId)
            return;
        if (!isWhitelisted(session.channelId))
            return '此群不在白名单中';
        if (!item)
            return '请指定物品';
        if (count === undefined)
            return '请指定数量';
        await ensureInitialized();
        const itemName = getItemName(item);
        if (!itemName)
            return '未找到该物品';
        const stockItem = stockData.get(itemName);
        if (!stockItem)
            return '物品不存在';
        stockItem.count = count;
        try {
            await saveStockItem(stockItem);
            const opTimestamp = Date.now();
            const getCode = createGetCode({
                timestamp: opTimestamp,
                userId: session.userId || 'unknown',
                itemName,
            });
            return `已将${itemName}库存设置为${count}瓶\n\n${getCode}`;
        }
        catch (err) {
            ctx.logger('stock-manager').error('设置库存失败:', err);
            return '设置库存失败，请稍后重试';
        }
    });
    stockCmd
        .subcommand('.list', '查看所有物品')
        .action(async ({ session }) => {
        if (!session || !session.channelId)
            return;
        if (!isWhitelisted(session.channelId))
            return '此群不在白名单中';
        await ensureInitialized();
        const items = Array.from(stockData.values());
        if (items.length === 0)
            return '暂无物品';
        return items
            .map(item => `${item.name}（别名：${item.aliases.join('、')}）当前库存：${item.count}瓶`)
            .join('\n');
    });
    // 注册排行榜查询指令
    ctx.command('rank [item:string]', '查询排行榜')
        .option('type', '-t <type:string>  排行榜类型：consume（消耗）或 add（累计）', { fallback: 'consume' })
        .action(async ({ session, options }, item) => {
        if (!session || !session.channelId)
            return;
        if (!isWhitelisted(session.channelId))
            return '此群不在白名单中';
        if (!item) {
            return '请指定物品，例如：rank water 或 rank water -t add';
        }
        await ensureInitialized();
        const itemName = getItemName(item);
        if (!itemName)
            return '未找到该物品';
        const type = (options?.type || 'consume');
        if (type !== 'consume' && type !== 'add') {
            return '排行榜类型必须是 consume（消耗）或 add（累计）';
        }
        const ranking = await getRanking(itemName, type);
        const rankingTitle = type === 'consume' ? '消耗排行榜' : '累计排行榜';
        return `${itemName}${rankingTitle}：\n${ranking}`;
    });
}
//# sourceMappingURL=index.js.map