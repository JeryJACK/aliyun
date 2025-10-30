/**
 * 性能监控工具
 * 自动收集和显示页面性能指标
 */

class PerformanceMonitor {
    constructor() {
        this.metrics = {};
        this.startTime = performance.now();
    }

    // 收集性能指标
    collectMetrics() {
        // Navigation Timing API
        if (performance.getEntriesByType) {
            const nav = performance.getEntriesByType('navigation')[0];
            if (nav) {
                this.metrics = {
                    // DNS查询时间
                    dnsTime: nav.domainLookupEnd - nav.domainLookupStart,
                    // TCP连接时间
                    tcpTime: nav.connectEnd - nav.connectStart,
                    // 请求响应时间
                    requestTime: nav.responseEnd - nav.requestStart,
                    // DOM解析时间
                    domParseTime: nav.domInteractive - nav.responseEnd,
                    // DOMContentLoaded时间
                    domContentLoadedTime: nav.domContentLoadedEventEnd - nav.domContentLoadedEventStart,
                    // 完整加载时间
                    loadTime: nav.loadEventEnd - nav.loadEventStart,
                    // 总时间
                    totalTime: nav.loadEventEnd - nav.fetchStart,
                    // 首字节时间 (TTFB)
                    ttfb: nav.responseStart - nav.requestStart
                };
            }
        }

        // Paint Timing API - 首次内容绘制
        if (performance.getEntriesByType) {
            const paintEntries = performance.getEntriesByType('paint');
            paintEntries.forEach(entry => {
                if (entry.name === 'first-contentful-paint') {
                    this.metrics.fcp = entry.startTime;
                }
                if (entry.name === 'first-paint') {
                    this.metrics.fp = entry.startTime;
                }
            });
        }

        // 资源加载统计
        if (performance.getEntriesByType) {
            const resources = performance.getEntriesByType('resource');
            this.metrics.resourceCount = resources.length;

            // 统计不同类型资源的大小和时间
            const resourceStats = {
                script: { count: 0, size: 0, time: 0 },
                css: { count: 0, size: 0, time: 0 },
                image: { count: 0, size: 0, time: 0 },
                other: { count: 0, size: 0, time: 0 }
            };

            resources.forEach(resource => {
                const type = this.getResourceType(resource.name);
                const category = resourceStats[type] || resourceStats.other;

                category.count++;
                category.size += resource.transferSize || 0;
                category.time += resource.duration;
            });

            this.metrics.resources = resourceStats;
        }

        return this.metrics;
    }

    // 判断资源类型
    getResourceType(url) {
        if (url.endsWith('.js') || url.includes('javascript')) return 'script';
        if (url.endsWith('.css') || url.includes('stylesheet')) return 'css';
        if (url.match(/\.(jpg|jpeg|png|gif|svg|webp|ico)$/i)) return 'image';
        return 'other';
    }

    // 格式化字节大小
    formatBytes(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
    }

    // 生成性能报告
    generateReport() {
        this.collectMetrics();

        const report = [
            '='.repeat(60),
            '📊 性能监控报告',
            '='.repeat(60),
            '',
            '⏱️ 关键时间指标:',
            `  - 首字节时间 (TTFB): ${this.metrics.ttfb?.toFixed(0) || 'N/A'}ms`,
            `  - 首次绘制 (FP): ${this.metrics.fp?.toFixed(0) || 'N/A'}ms`,
            `  - 首次内容绘制 (FCP): ${this.metrics.fcp?.toFixed(0) || 'N/A'}ms`,
            `  - DOM解析时间: ${this.metrics.domParseTime?.toFixed(0) || 'N/A'}ms`,
            `  - DOMContentLoaded: ${this.metrics.domContentLoadedTime?.toFixed(0) || 'N/A'}ms`,
            `  - 页面完全加载: ${this.metrics.totalTime?.toFixed(0) || 'N/A'}ms`,
            '',
            '🌐 网络性能:',
            `  - DNS查询: ${this.metrics.dnsTime?.toFixed(0) || 'N/A'}ms`,
            `  - TCP连接: ${this.metrics.tcpTime?.toFixed(0) || 'N/A'}ms`,
            `  - 请求响应: ${this.metrics.requestTime?.toFixed(0) || 'N/A'}ms`,
            '',
            '📦 资源加载统计:',
            `  - 总资源数: ${this.metrics.resourceCount || 0}`,
        ];

        if (this.metrics.resources) {
            Object.entries(this.metrics.resources).forEach(([type, stats]) => {
                if (stats.count > 0) {
                    report.push(
                        `  - ${type}: ${stats.count}个, ${this.formatBytes(stats.size)}, ${stats.time.toFixed(0)}ms`
                    );
                }
            });
        }

        report.push(
            '',
            '='.repeat(60)
        );

        return report.join('\n');
    }

    // 在控制台显示报告
    logReport() {
        console.log(this.generateReport());
    }

    // 获取性能评分（0-100）
    getPerformanceScore() {
        this.collectMetrics();

        let score = 100;

        // FCP评分（目标：<1800ms）
        if (this.metrics.fcp) {
            if (this.metrics.fcp > 1800) score -= 20;
            else if (this.metrics.fcp > 1000) score -= 10;
        }

        // TTFB评分（目标：<600ms）
        if (this.metrics.ttfb) {
            if (this.metrics.ttfb > 600) score -= 15;
            else if (this.metrics.ttfb > 300) score -= 5;
        }

        // 总加载时间评分（目标：<3000ms）
        if (this.metrics.totalTime) {
            if (this.metrics.totalTime > 5000) score -= 25;
            else if (this.metrics.totalTime > 3000) score -= 15;
        }

        return Math.max(0, score);
    }

    // 显示性能徽章
    showPerformanceBadge() {
        const score = this.getPerformanceScore();
        let color, label;

        if (score >= 90) {
            color = '#00b42a';
            label = '优秀';
        } else if (score >= 70) {
            color = '#165dff';
            label = '良好';
        } else if (score >= 50) {
            color = '#ff7d00';
            label = '一般';
        } else {
            color = '#f53f3f';
            label = '较差';
        }

        console.log(
            `%c⚡ 性能评分: ${score}/100 (${label})`,
            `color: white; background: ${color}; padding: 4px 8px; border-radius: 4px; font-weight: bold;`
        );
    }
}

// 创建全局实例
window.performanceMonitor = new PerformanceMonitor();

// 页面加载完成后自动生成报告
if (document.readyState === 'loading') {
    window.addEventListener('load', () => {
        setTimeout(() => {
            window.performanceMonitor.showPerformanceBadge();
            window.performanceMonitor.logReport();
        }, 1000);
    });
} else {
    setTimeout(() => {
        window.performanceMonitor.showPerformanceBadge();
        window.performanceMonitor.logReport();
    }, 1000);
}

// 提供手动调用方法
console.log('💡 提示：使用 performanceMonitor.logReport() 查看性能报告');
console.log('💡 提示：使用 performanceMonitor.getPerformanceScore() 获取性能评分');
