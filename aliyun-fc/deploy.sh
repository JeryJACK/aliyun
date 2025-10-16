#!/bin/bash

# 阿里云函数计算部署脚本
# 使用 Serverless Devs 工具进行部署

set -e

echo "🚀 开始部署卫星数据分析系统到阿里云函数计算..."

# 检查必要的工具
if ! command -v s &> /dev/null; then
    echo "❌ 未找到 Serverless Devs CLI，请先安装："
    echo "npm install -g @serverless-devs/s"
    exit 1
fi

# 检查环境变量文件
if [ ! -f ".env" ]; then
    echo "❌ 未找到 .env 文件，请先创建并配置环境变量"
    echo "可以从 .env.example 复制："
    echo "cp .env.example .env"
    exit 1
fi

# 加载环境变量
source .env

# 验证必要的环境变量
required_vars=("MYSQL_HOST" "MYSQL_USER" "MYSQL_PASSWORD" "MYSQL_DATABASE" "JWT_SECRET")
for var in "${required_vars[@]}"; do
    if [ -z "${!var}" ]; then
        echo "❌ 环境变量 $var 未设置"
        exit 1
    fi
done

echo "✅ 环境变量检查通过"

# 安装依赖
echo "📦 安装 Node.js 依赖..."
npm install --production

# 部署函数
echo "🔧 部署函数到阿里云..."
s deploy

echo "✅ 部署完成！"

# 输出访问信息
echo ""
echo "🌐 API 访问地址："
echo "登录接口: https://your-account-id.cn-hangzhou.fc.aliyuncs.com/2016-08-15/proxy/satellite-analysis/login"
echo "统计接口: https://your-account-id.cn-hangzhou.fc.aliyuncs.com/2016-08-15/proxy/satellite-analysis/stats"
echo "图表接口: https://your-account-id.cn-hangzhou.fc.aliyuncs.com/2016-08-15/proxy/satellite-analysis/chart-data"
echo "记录接口: https://your-account-id.cn-hangzhou.fc.aliyuncs.com/2016-08-15/proxy/satellite-analysis/records"
echo "导入接口: https://your-account-id.cn-hangzhou.fc.aliyuncs.com/2016-08-15/proxy/satellite-analysis/import"
echo ""
echo "请更新前端配置文件中的 API_BASE_URL 为上述地址"