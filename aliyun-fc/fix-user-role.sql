-- 检查当前用户数据
SELECT id, username, role, created_at FROM users WHERE username = 'yuxing';

-- 修复用户角色（将role从密码改为admin）
UPDATE users SET role = 'admin' WHERE username = 'yuxing';

-- 确认修复结果
SELECT id, username, role, created_at FROM users WHERE username = 'yuxing';
