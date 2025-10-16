#!/bin/bash
# GitHub Pages 部署脚本

echo "🚀 开始部署到 GitHub Pages..."

# 检查是否在正确的目录
if [ ! -f "index.html" ]; then
    echo "❌ 错误：请在项目根目录运行此脚本"
    exit 1
fi

# 检查 git 状态
if [ ! -d ".git" ]; then
    echo "📦 初始化 Git 仓库..."
    git init
    echo "✅ Git 仓库已初始化"
    echo ""
    echo "⚠️  请先在 GitHub 创建仓库，然后运行："
    echo "   git remote add origin https://github.com/你的用户名/你的仓库名.git"
    exit 0
fi

# 显示当前状态
echo ""
echo "📊 当前 Git 状态："
git status --short

echo ""
read -p "是否继续部署? (y/n) " -n 1 -r
echo ""

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "❌ 部署已取消"
    exit 0
fi

# 添加文件
echo ""
echo "📝 添加前端文件..."
git add index.html login.html admin.html circle-warning.html data-distribution.html trend-analysis.html
git add public/
git add .github/
git add .gitignore
git add README.md README-deployment.md GITHUB-DEPLOYMENT.md
git add favicon.ico

# 显示将要提交的文件
echo ""
echo "📋 将要提交的文件："
git status --short

# 获取提交信息
echo ""
read -p "请输入提交信息（直接回车使用默认信息）: " commit_message

if [ -z "$commit_message" ]; then
    commit_message="Update frontend deployment $(date '+%Y-%m-%d %H:%M:%S')"
fi

# 提交
echo ""
echo "💾 提交更改..."
git commit -m "$commit_message"

# 推送
echo ""
echo "📤 推送到 GitHub..."
git push origin main

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ 部署成功！"
    echo ""
    echo "🌐 GitHub Pages 将在 1-2 分钟后更新"
    echo "📍 访问地址: https://你的用户名.github.io/你的仓库名/"
    echo ""
    echo "💡 提示："
    echo "   - 如果首次部署，需要在 GitHub 仓库设置中启用 Pages"
    echo "   - Settings → Pages → Source: Deploy from a branch"
    echo "   - Branch: main / (root)"
else
    echo ""
    echo "❌ 推送失败"
    echo "💡 可能的原因："
    echo "   1. 没有配置远程仓库，运行: git remote add origin <URL>"
    echo "   2. 需要先拉取远程更改，运行: git pull origin main"
    echo "   3. 认证失败，检查 GitHub 凭据"
fi
