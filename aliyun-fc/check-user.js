// 检查数据库中的用户
const { getUserByUsername } = require('./lib/db-mysql');

async function checkUser() {
    try {
        const username = 'yuxing';
        console.log(`正在查询用户: ${username}`);

        const user = await getUserByUsername(username);

        if (user) {
            console.log('\n✅ 找到用户:');
            console.log('ID:', user.id);
            console.log('用户名:', user.username);
            console.log('角色:', user.role);
            console.log('密码哈希:', user.password_hash);
            console.log('\n密码哈希长度:', user.password_hash?.length);
            console.log('密码哈希格式:', user.password_hash?.startsWith('$2b$') ? 'bcrypt格式正确' : '格式错误');
        } else {
            console.log('\n❌ 未找到用户:', username);
            console.log('\n请检查:');
            console.log('1. 数据库连接是否正常');
            console.log('2. users表中是否存在该用户');
            console.log('3. 用户名拼写是否正确（区分大小写）');
        }

        process.exit(0);
    } catch (error) {
        console.error('\n❌ 查询失败:', error.message);
        console.error('\n详细错误:', error);
        process.exit(1);
    }
}

checkUser();
