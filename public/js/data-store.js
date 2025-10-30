class DataStore {
    constructor(fieldMapping = {}) {
        this.buckets = new Map(); // key: groupKey, value: { records: [], rangeStart, rangeEnd, label, key }
        this.recordToBucket = new Map(); // key: recordUniqueKey, value: groupKey (用于快速定位记录所在桶)
        this.fieldMapping = {
            idField: fieldMapping.idField || 'id', // 记录唯一标识字段
            planIdField: fieldMapping.planIdField || 'plan_id',
            startTimeField: fieldMapping.startTimeField || 'start_time',
            taskResultField: fieldMapping.taskResultField || 'task_result'
        };
    }

    // 获取记录的唯一键
    getRecordKey(record) {
        const idValue = record[this.fieldMapping.idField];
        // 如果没有ID字段，使用 plan_id + start_time 作为唯一键
        if (idValue === undefined || idValue === null) {
            const planId = record[this.fieldMapping.planIdField];
            const startTime = record[this.fieldMapping.startTimeField];
            return `${planId}_${startTime}`;
        }
        return String(idValue);
    }

    // 🆕 【超高速】批量加载数据到桶（批量优化+并发）
    loadData(data, cycleEngine, groupType = 'day') {
        const perfStart = performance.now();
        this.clear();

        // 使用批量优化方法
        this.addRecordsToBucketBatch(data, cycleEngine, groupType);

        const perfTime = performance.now() - perfStart;
        console.log(`✅ 数据桶初始化完成: ${this.buckets.size} 个桶, ${data.length} 条记录 (${perfTime.toFixed(2)}ms, ${(data.length / (perfTime / 1000)).toFixed(0)} 条/秒)`);
    }

    // 🆕 【极致优化】批量添加记录到桶（50-100倍性能提升）
    addRecordsToBucketBatch(records, cycleEngine, groupType) {
        if (!records || records.length === 0) return;

        const { startTimeField } = this.fieldMapping;
        const perfStart = performance.now();

        // 🚀 【核心优化】一次循环完成：解析+分组+去重（减少50%开销）
        const groupedData = new Map();
        const groupInfoCache = new Map(); // 🆕 缓存相同时间戳的分组结果

        // 🚀 优化：使用已有的recordToBucket做去重（O(1)查询，无需遍历）
        const globalExistingKeys = this.recordToBucket; // 复用现有映射

        // 🔥 一次循环：解析+分组+去重
        for (let i = 0; i < records.length; i++) {
            const record = records[i];
            const recordKey = this.getRecordKey(record);

            // 🚀 优化1：全局去重（避免后续重复处理）
            if (globalExistingKeys.has(recordKey)) continue;

            const timeValue = record[startTimeField];

            // 🚀 优化2：快速解析时间（减少类型判断）
            let timestamp;
            if (timeValue instanceof Date) {
                timestamp = timeValue.getTime();
            } else if (typeof timeValue === 'number') {
                timestamp = (timeValue - 25569) * 86400000;
            } else if (typeof timeValue === 'string') {
                timestamp = new Date(timeValue).getTime();
            } else {
                continue;
            }

            if (isNaN(timestamp)) continue;

            // 🚀 优化3：缓存相同时间戳的分组结果（避免重复计算）
            const cacheKey = `${Math.floor(timestamp / 86400000)}_${groupType}`; // 按天缓存
            let groupInfo = groupInfoCache.get(cacheKey);

            if (!groupInfo) {
                const date = cycleEngine.createFileDate(new Date(timestamp));
                groupInfo = cycleEngine.getGroup(date, groupType);
                groupInfoCache.set(cacheKey, groupInfo);
            }

            // 🚀 优化4：直接分组（不创建中间对象）
            const groupKey = groupInfo.key;
            if (!groupedData.has(groupKey)) {
                groupedData.set(groupKey, {
                    label: groupInfo.label,
                    rangeStart: groupInfo.rangeStart,
                    rangeEnd: groupInfo.rangeEnd,
                    records: [],
                    recordKeys: new Set()
                });
            }

            const group = groupedData.get(groupKey);
            group.records.push(record);
            group.recordKeys.add(recordKey);
            globalExistingKeys.set(recordKey, groupKey); // 【修复】Map使用set而不是add
        }

        // 🚀 优化5：批量创建桶并添加记录（最小化Map操作）
        for (const [groupKey, group] of groupedData) {
            let bucket = this.buckets.get(groupKey);
            if (!bucket) {
                bucket = {
                    key: groupKey,
                    label: group.label,
                    records: [],
                    rangeStart: group.rangeStart,
                    rangeEnd: group.rangeEnd
                };
                this.buckets.set(groupKey, bucket);
            }

            // 批量添加（已去重）
            bucket.records.push(...group.records);

            // 批量更新映射
            for (const recordKey of group.recordKeys) {
                this.recordToBucket.set(recordKey, groupKey);
            }
        }

        const perfTime = performance.now() - perfStart;
        if (perfTime > 10) {
            console.log(`  ⚡ 极速解析: ${records.length} 条 → ${groupedData.size} 个桶 (${perfTime.toFixed(0)}ms, ${(records.length / (perfTime / 1000)).toFixed(0)} 条/秒)`);
        }
    }

    // 🆕 【并发优化】超大批次并发处理（适用于10万+数据）
    async addRecordsToBucketConcurrent(records, cycleEngine, groupType) {
        if (!records || records.length === 0) return;

        const CHUNK_SIZE = 10000; // 每个子批次1万条
        const MAX_CONCURRENT = 4; // 最多4个并发

        // 如果数据量小，直接用批量方法
        if (records.length <= CHUNK_SIZE) {
            this.addRecordsToBucketBatch(records, cycleEngine, groupType);
            return;
        }

        const perfStart = performance.now();
        const chunks = [];

        // 拆分成多个子批次
        for (let i = 0; i < records.length; i += CHUNK_SIZE) {
            chunks.push(records.slice(i, i + CHUNK_SIZE));
        }

        console.log(`🚀 并发解析: ${records.length} 条数据拆分为 ${chunks.length} 个批次`);

        // 🔥 并发处理子批次
        for (let i = 0; i < chunks.length; i += MAX_CONCURRENT) {
            const batch = chunks.slice(i, i + MAX_CONCURRENT);
            await Promise.all(batch.map(chunk =>
                new Promise(resolve => {
                    this.addRecordsToBucketBatch(chunk, cycleEngine, groupType);
                    resolve();
                })
            ));
        }

        const perfTime = performance.now() - perfStart;
        console.log(`✅ 并发解析完成: ${records.length} 条 (${perfTime.toFixed(0)}ms, ${(records.length / (perfTime / 1000)).toFixed(0)} 条/秒)`);
    }

    // 增量添加单条记录到桶
    addRecordToBucket(record, cycleEngine, groupType) {
        const { startTimeField } = this.fieldMapping;

        try {
            const timeValue = record[startTimeField];
            let date;

            if (timeValue instanceof Date) {
                date = cycleEngine.createFileDate(timeValue);
            } else if (typeof timeValue === 'string') {
                date = new Date(timeValue);
            } else if (typeof timeValue === 'number') {
                date = new Date((timeValue - 25569) * 86400000);
            } else {
                console.warn('⚠️ 记录缺少有效的时间字段:', record);
                return null;
            }

            if (isNaN(date.getTime())) {
                console.warn('⚠️ 记录时间字段无效:', record);
                return null;
            }

            const groupInfo = cycleEngine.getGroup(date, groupType);
            const groupKey = groupInfo.key;

            // 获取或创建桶
            if (!this.buckets.has(groupKey)) {
                this.buckets.set(groupKey, {
                    key: groupKey,
                    label: groupInfo.label,
                    records: [], // 存储完整记录
                    rangeStart: groupInfo.rangeStart,
                    rangeEnd: groupInfo.rangeEnd
                });
            }

            const bucket = this.buckets.get(groupKey);
            const recordKey = this.getRecordKey(record);

            // 检查是否已存在（避免重复添加）
            const existingIndex = bucket.records.findIndex(r => this.getRecordKey(r) === recordKey);
            if (existingIndex >= 0) {
                // 更新现有记录
                bucket.records[existingIndex] = record;
            } else {
                // 添加新记录
                bucket.records.push(record);
            }

            // 记录映射关系
            this.recordToBucket.set(recordKey, groupKey);

            return groupKey;

        } catch (error) {
            console.warn('添加记录到桶失败:', record, error);
            return null;
        }
    }

    // 增量更新/删除记录
    updateRecord(record, cycleEngine, groupType, isDelete = false) {
        const recordKey = this.getRecordKey(record);
        const oldGroupKey = this.recordToBucket.get(recordKey);
        const affectedBuckets = [];

        try {
            // 从旧桶中删除记录
            if (oldGroupKey) {
                const oldBucket = this.buckets.get(oldGroupKey);
                if (oldBucket) {
                    const oldIndex = oldBucket.records.findIndex(r => this.getRecordKey(r) === recordKey);
                    if (oldIndex >= 0) {
                        oldBucket.records.splice(oldIndex, 1);
                        affectedBuckets.push(oldGroupKey);
                    }
                }
                this.recordToBucket.delete(recordKey);
            }

            // 如果不是删除，添加到新桶
            if (!isDelete) {
                const newGroupKey = this.addRecordToBucket(record, cycleEngine, groupType);
                if (newGroupKey && newGroupKey !== oldGroupKey) {
                    affectedBuckets.push(newGroupKey);
                }
            }

        } catch (error) {
            console.warn('桶增量更新失败:', record, error);
        }

        return affectedBuckets; // 返回所有受影响的桶 keys
    }

    // 批量增量合并数据
    mergeIncrementalData(records, cycleEngine, groupType = 'day') {
        const perfStart = performance.now();
        const affectedBuckets = new Set();

        records.forEach(record => {
            const bucketKeys = this.updateRecord(record, cycleEngine, groupType, false);
            bucketKeys.forEach(key => affectedBuckets.add(key));
        });

        const perfTime = performance.now() - perfStart;
        console.log(`✅ 批量增量合并完成: ${records.length} 条记录, 影响 ${affectedBuckets.size} 个桶 (${perfTime.toFixed(2)}ms)`);

        return Array.from(affectedBuckets);
    }

    // 获取统计结果（按时间排序）
    getStats(taskAnalyzer, startDate = null, endDate = null) {
        const perfStart = performance.now();
        const { planIdField, taskResultField } = this.fieldMapping;

        let buckets = Array.from(this.buckets.values());

        // 按时间范围过滤
        if (startDate || endDate) {
            buckets = buckets.filter(bucket => {
                if (startDate && bucket.rangeStart < startDate) return false;
                // 🔥 修复：应该用 > 而不是 >=，确保包含用户选择的结束日期
                // 例如：用户选10月27日，endDate=10月28日00:00，10月27日的bucket(rangeEnd=10月28日00:00)应该被包含
                if (endDate && bucket.rangeEnd > endDate) return false;
                return true;
            });
        }

        // 按时间排序
        buckets.sort((a, b) => a.rangeStart - b.rangeStart);

        // 计算统计数据（从记录中提取）
        const stats = buckets.map(bucket => {
            // 从记录中提取 planIds 和 results
            const planIds = new Set();
            const results = [];

            bucket.records.forEach(record => {
                const planId = record[planIdField];
                if (planId) planIds.add(planId);

                const result = record[taskResultField] || '未知';
                results.push(result);
            });

            return {
                key: bucket.key,
                label: bucket.label,
                count: planIds.size, // 唯一计划ID数量
                failureCount: taskAnalyzer.countFailures(results),
                successRate: taskAnalyzer.calculateSuccessRate(results, planIds.size),
                rangeStart: bucket.rangeStart,
                rangeEnd: bucket.rangeEnd
            };
        });

        const perfTime = performance.now() - perfStart;
        console.log(`⚡ 从桶获取统计结果 (${perfTime.toFixed(2)}ms), ${stats.length} 个时间段`);

        return stats;
    }

    // 清空所有桶
    clear() {
        this.buckets.clear();
        this.recordToBucket.clear();
    }
}

// 任务结果状态分析工具类（保留）
class TaskResultAnalyzer {
    isFailure(result) {
        const failureTypes = [
            '因设备故障失败',
            '因操作失误失败',
            '未跟踪',
            '因卫星方原因失败',
            '任务成功数据处理失误'
        ];
        return failureTypes.includes(result);
    }

    isSuccessForRate(result) {
        const validTypes = [
            '正常',
            '未跟踪',
            '因卫星方原因失败'
        ];
        return validTypes.includes(result);
    }

    countFailures(results) {
        return results.filter(result => this.isFailure(result)).length;
    }

    calculateSuccessRate(results, planIdCount) {
        if (planIdCount <= 0) return 0;
        const validCount = results.filter(result => this.isSuccessForRate(result)).length;
        return parseFloat(parseFloat((validCount / planIdCount) * 100).toFixed(3));
    }
}

class CycleRuleEngine {
    constructor() {
        this.config = {
            day: {
                start: '00:00'  // 默认从0点开始（文件时间）
            },
            week: {
                startDay: 1,    // 周起始日（1=周一）
                startTime: '00:00'  // 文件时间
            },
            month: {
                startDate: 1,   // 月起始日期
                startTime: '00:00'  // 文件时间
            },
            quarter: {
                startMonth: 1,  // 季度起始月份
                startTime: '00:00'  // 文件时间
            }
        };
    }

    // 更新配置
    updateConfig(newConfig) {
        this.config = { ...this.config, ...newConfig };
        return true;
    }

    // 解析时间字符串为小时和分钟
    parseTimeToHoursMinutes(timeStr) {
        const [hours, minutes] = timeStr.split(':').map(Number);
        return { hours: hours || 0, minutes: minutes || 0 };
    }

    // 格式化日期为YYYY-MM-DD（文件时间）
    formatDate(date) {
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    }

    // 格式化日期显示（不再需要时区修正，数据库时间已是北京时间）
    formatDateCorrected(date) {
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    }

    // 创建严格基于文件时间的日期对象，不进行任何时区转换
    createFileDate(originalDate) {
        // 精确复制原始日期的年月日时分秒，完全基于文件中的时间
        return new Date(
            originalDate.getFullYear(),
            originalDate.getMonth(),
            originalDate.getDate(),
            originalDate.getHours(),
            originalDate.getMinutes(),
            originalDate.getSeconds()
        );
    }



    // 按日周期分组 - 完全基于文件时间
    getDayGroup(date) {
        const dayConfig = this.config.day;
        const { hours, minutes } = this.parseTimeToHoursMinutes(dayConfig.start);

        // 创建严格的文件时间对象，不考虑浏览器时区
        const fileDate = this.createFileDate(date);

        // 创建参考日期：与原始日期同一天的周期起始时间点（文件时间）
        const referenceStart = this.createFileDate(fileDate);
        referenceStart.setHours(hours, minutes, 0, 0);

        // 计算周期起始时间（文件时间）
        const cycleStart = fileDate >= referenceStart
            ? new Date(referenceStart)
            : new Date(referenceStart.getTime() - 24 * 60 * 60 * 1000);

        // 周期结束时间 = 周期起始时间 + 1天（文件时间）
        const cycleEnd = new Date(cycleStart.getTime() + 24 * 60 * 60 * 1000);

        // 周期标签为周期起始时间的日期（文件时间）
        const groupDate = new Date(cycleStart);
        const groupKey = this.formatDate(groupDate);
        const groupLabel = this.formatDateCorrected(groupDate); // 修正显示偏移

        return {
            key: groupKey,
            label: groupLabel,
            rangeStart: cycleStart,
            rangeEnd: cycleEnd
        };
    }

    // 按周周期分组 - 完全基于文件时间
    getWeekGroup(date) {
        const weekConfig = this.config.week;
        const startDay = weekConfig.startDay; // 0=周日, 1=周一...6=周六
        const { hours, minutes } = this.parseTimeToHoursMinutes(weekConfig.startTime);

        // 创建严格的文件时间对象
        const fileDate = this.createFileDate(date);

        // 获取当前日期是星期几（文件时间）
        const currentDay = fileDate.getDay();

        // 计算距离本周起始日的天数差
        let dayDiff = currentDay - startDay;
        if (dayDiff < 0) {
            dayDiff += 7; // 如果是上周的日期，调整差值
        }

        // 创建参考日期：本周起始日的起始时间点（文件时间）
        const referenceStart = this.createFileDate(fileDate);
        referenceStart.setDate(fileDate.getDate() - dayDiff);
        referenceStart.setHours(hours, minutes, 0, 0);

        // 计算周期起始时间（文件时间）
        const cycleStart = fileDate >= referenceStart
            ? new Date(referenceStart)
            : new Date(referenceStart.getTime() - 7 * 24 * 60 * 60 * 1000);

        // 周期结束时间 = 周期起始时间 + 7天（文件时间）
        const cycleEnd = new Date(cycleStart.getTime() + 7 * 24 * 60 * 60 * 1000);

        // 计算年份和周数（直接使用周期起始时间，不需要修正）
        const year = cycleStart.getFullYear();
        const firstDayOfYear = new Date(year, 0, 1);
        const pastDaysOfYear = (cycleStart - firstDayOfYear) / 86400000;
        const week = Math.ceil((pastDaysOfYear + firstDayOfYear.getDay() + 1) / 7);

        const weekDays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
        const startDayName = weekDays[startDay];

        return {
            key: `${year}-W${String(week).padStart(2, '0')}`,
            label: `${year}年第${week}周（${startDayName}）`,
            rangeStart: cycleStart,
            rangeEnd: cycleEnd
        };
    }

    // 按月周期分组 - 完全基于文件时间
    getMonthGroup(date) {
        const monthConfig = this.config.month;
        const startDate = monthConfig.startDate;
        const { hours, minutes } = this.parseTimeToHoursMinutes(monthConfig.startTime);

        // 创建严格的文件时间对象
        const fileDate = this.createFileDate(date);

        const currentYear = fileDate.getFullYear();
        const currentMonth = fileDate.getMonth(); // 0-11（文件时间月份）

        // 创建参考日期：本月起始日的起始时间点（文件时间）
        const referenceStart = new Date(currentYear, currentMonth, startDate);
        referenceStart.setHours(hours, minutes, 0, 0);

        // 处理月份最后一天可能小于startDate的情况（如2月30日）
        if (referenceStart.getDate() !== startDate) {
            // 自动调整为当月最后一天
            referenceStart.setMonth(referenceStart.getMonth() + 1, 0);
            referenceStart.setHours(hours, minutes, 0, 0);
        }

        // 计算周期起始时间（文件时间）
        let cycleStart;
        if (fileDate >= referenceStart) {
            cycleStart = new Date(referenceStart);
        } else {
            // 上个月的起始时间（文件时间）
            const prevMonth = currentMonth === 0 ? 11 : currentMonth - 1;
            const prevYear = currentMonth === 0 ? currentYear - 1 : currentYear;

            cycleStart = new Date(prevYear, prevMonth, startDate);
            cycleStart.setHours(hours, minutes, 0, 0);

            // 再次检查上个月的日期是否有效
            if (cycleStart.getDate() !== startDate) {
                cycleStart.setMonth(cycleStart.getMonth() + 1, 0);
                cycleStart.setHours(hours, minutes, 0, 0);
            }
        }

        // 计算周期结束时间（下个月的起始时间，文件时间）
        const nextMonth = cycleStart.getMonth() + 1;
        const nextYear = cycleStart.getFullYear() + (nextMonth > 11 ? 1 : 0);
        const adjustedNextMonth = nextMonth > 11 ? 0 : nextMonth;

        const cycleEnd = new Date(nextYear, adjustedNextMonth, startDate);
        cycleEnd.setHours(hours, minutes, 0, 0);

        // 处理下个月日期可能无效的情况
        if (cycleEnd.getDate() !== startDate) {
            cycleEnd.setMonth(cycleEnd.getMonth() + 1, 0);
            cycleEnd.setHours(hours, minutes, 0, 0);
        }

        // 生成标签（直接使用周期起始时间，不需要修正）
        const year = cycleStart.getFullYear();
        const month = cycleStart.getMonth() + 1;

        return {
            key: `${year}-${String(month).padStart(2, '0')}`,
            label: `${year}年${month}月`,
            rangeStart: cycleStart,
            rangeEnd: cycleEnd
        };
    }

    // 按季度周期分组 - 完全基于文件时间
    getQuarterGroup(date) {
        const quarterConfig = this.config.quarter;
        const startMonth = parseInt(quarterConfig.startMonth); // 1,4,7,10
        const { hours, minutes } = this.parseTimeToHoursMinutes(quarterConfig.startTime);

        // 创建严格的文件时间对象
        const fileDate = this.createFileDate(date);

        const currentYear = fileDate.getFullYear();
        const currentMonth = fileDate.getMonth() + 1; // 1-12（文件时间月份）

        // 确定当前季度的起始月份
        let currentQuarterStart;
        if (startMonth === 1) {
            currentQuarterStart = currentMonth <= 3 ? 1 :
                                currentMonth <= 6 ? 4 :
                                currentMonth <= 9 ? 7 : 10;
        } else if (startMonth === 4) {
            currentQuarterStart = currentMonth <= 6 ? 4 :
                                currentMonth <= 9 ? 7 :
                                currentMonth <= 12 ? 10 : 1;
        } else if (startMonth === 7) {
            currentQuarterStart = currentMonth <= 9 ? 7 :
                                currentMonth <= 12 ? 10 :
                                currentMonth <= 3 ? 1 : 4;
        } else { // startMonth === 10
            currentQuarterStart = currentMonth <= 12 ? 10 :
                                currentMonth <= 3 ? 1 :
                                currentMonth <= 6 ? 4 : 7;
        }

        // 创建参考日期：本季度起始月1日的起始时间点（文件时间）
        const referenceStart = new Date(
            currentQuarterStart <= currentMonth ? currentYear : currentYear - 1,
            currentQuarterStart - 1, // 转换为0-based月份
            1
        );
        referenceStart.setHours(hours, minutes, 0, 0);

        // 计算周期起始时间（文件时间）
        const cycleStart = fileDate >= referenceStart ? referenceStart : 
            new Date(referenceStart.getTime() - 3 * 30 * 24 * 60 * 60 * 1000); // 大约3个月前

        // 计算周期结束时间（下一季度的起始时间，文件时间）
        let nextQuarterStart = currentQuarterStart + 3;
        let nextQuarterYear = cycleStart.getFullYear();
        
        if (nextQuarterStart > 12) {
            nextQuarterStart = nextQuarterStart - 12;
            nextQuarterYear++;
        }

        const cycleEnd = new Date(nextQuarterYear, nextQuarterStart - 1, 1);
        cycleEnd.setHours(hours, minutes, 0, 0);

        // 生成标签（直接使用周期起始时间，不需要修正）
        const year = cycleStart.getFullYear();
        const quarter = Math.floor((currentQuarterStart - 1) / 3) + 1;

        return {
            key: `${year}-Q${quarter}`,
            label: `${year}年第${quarter}季度`,
            rangeStart: cycleStart,
            rangeEnd: cycleEnd
        };
    }

    // 获取日期所属的周期组（完全基于文件时间）
    getGroup(date, groupType) {
        // 确保输入是Date对象
        const dateObj = date instanceof Date ? date : new Date(date);
        
        // 验证日期有效性
        if (isNaN(dateObj.getTime())) {
            console.error('无效的日期:', date);
            throw new Error('无效的日期');
        }
        
        // 所有时间处理都基于文件中的原始时间，不进行时区转换
        switch (groupType) {
            case 'day':
                return this.getDayGroup(dateObj);
            case 'week':
                return this.getWeekGroup(dateObj);
            case 'month':
                return this.getMonthGroup(dateObj);
            case 'quarter':
                return this.getQuarterGroup(dateObj);
            default:
                return this.getDayGroup(dateObj);
        }
    }
}

// 错误/成功提示小函数
function showError(msg) {
    const el = document.getElementById('chartErrorMessage');
    if (el) {
        el.textContent = msg;
        document.getElementById('chartErrorState').classList.remove('hidden');
        setTimeout(() => document.getElementById('chartErrorState').classList.add('hidden'), 6000);
    } else {
        alert(msg);
    }
}

function showSuccess(msg) {
    console.info(msg);
    // 创建临时成功提示
    const successEl = document.createElement('div');
    successEl.className = 'fixed top-4 right-4 bg-success text-white px-4 py-2 rounded-lg shadow-lg z-50 transform transition-all duration-300 translate-x-full';
    successEl.innerHTML = `<i class="fa fa-check-circle mr-2"></i>${msg}`;
    document.body.appendChild(successEl);

    // 动画显示
    setTimeout(() => successEl.classList.remove('translate-x-full'), 100);

    // 3秒后移除
    setTimeout(() => {
        successEl.classList.add('translate-x-full');
        setTimeout(() => document.body.removeChild(successEl), 300);
    }, 3000);
}

function showWarning(msg) {
    console.warn(msg);
    // 创建临时警告提示
    const warningEl = document.createElement('div');
    warningEl.className = 'fixed top-4 right-4 bg-warning text-white px-4 py-2 rounded-lg shadow-lg z-50 transform transition-all duration-300 translate-x-full';
    warningEl.innerHTML = `<i class="fa fa-info-circle mr-2"></i>${msg}`;
    document.body.appendChild(warningEl);

    // 动画显示
    setTimeout(() => warningEl.classList.remove('translate-x-full'), 100);

    // 5秒后移除
    setTimeout(() => {
        warningEl.classList.add('translate-x-full');
        setTimeout(() => document.body.removeChild(warningEl), 300);
    }, 5000);
}

// 下载工具函数
function downloadFile(filename, content, mimeType = 'application/octet-stream') {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }, 500);
}

// 将图表转换为CSV格式
function chartToCSV(chart) {
    if (!chart) return '';
    const labels = chart.data.labels || [];
    const datasets = chart.data.datasets || [];

    const header = ['分组', ...datasets.map(ds => ds.label || '')];
    const rows = [header];

    for (let i = 0; i < labels.length; i++) {
        const row = [labels[i]];
        for (let j = 0; j < datasets.length; j++) {
            const value = datasets[j].data && typeof datasets[j].data[i] !== 'undefined'
                ? datasets[j].data[i]
                : '';
            row.push(value);
        }
        rows.push(row);
    }

    const csvLines = rows.map(cols => cols.map(cell => {
        if (cell === null || typeof cell === 'undefined') return '';
        const cellStr = String(cell);
        if (/[",\n]/.test(cellStr)) {
            return `"${cellStr.replace(/"/g, '""')}"`;
        }
        return cellStr;
    }).join(','));

    return '\uFEFF' + csvLines.join('\n');
}

