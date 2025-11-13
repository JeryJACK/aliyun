/**
 * 🎨 主题管理器 - 支持深色/浅色模式切换 + 多彩主题切换
 * 功能：
 * 1. 深色/浅色模式切换
 * 2. 9种彩色主题切换
 * 3. 自动保存用户偏好
 * 4. 页面加载时自动应用上次选择的主题
 */

class ThemeManager {
  constructor() {
    // 主题配置
    this.themes = {
      // 颜色主题
      colors: [
        { id: 'blue', name: '科技蓝', class: '', color: '#165DFF' },
        { id: 'orange', name: '落日橙', class: 'theme-orange', color: '#FF7D00' },
        { id: 'green', name: '森林绿', class: 'theme-green', color: '#00B42A' },
        { id: 'cyan', name: '海洋青', class: 'theme-cyan', color: '#36CFC9' },
        { id: 'purple', name: '极光紫', class: 'theme-purple', color: '#722ED1' },
        { id: 'pink', name: '樱花粉', class: 'theme-pink', color: '#EC4899' },
        { id: 'red', name: '热情红', class: 'theme-red', color: '#EF4444' },
        { id: 'brown', name: '咖啡棕', class: 'theme-brown', color: '#A55449' },
        { id: 'amber', name: '黄昏金', class: 'theme-amber', color: '#F59E0B' },
        { id: 'rainbow', name: '彩虹', class: 'theme-rainbow', color: 'linear-gradient(90deg, #EF4444, #F97316, #F59E0B, #22C55E, #0EA5E9, #6366F1, #A855F7)' }
      ],
      // 模式
      modes: [
        { id: 'light', name: '浅色', class: '' },
        { id: 'dark', name: '深色', class: 'theme-dark' }
      ]
    };

    // 默认主题
    this.currentColorTheme = 'blue';
    this.currentMode = 'light';

    // 初始化
    this.init();
  }

  /**
   * 初始化主题管理器
   */
  init() {
    console.log('🎨 主题管理器初始化...');

    // 从 localStorage 恢复上次的主题设置
    this.loadThemeFromStorage();

    // 应用主题
    this.applyTheme();

    // 创建主题切换UI
    this.createThemeSwitcher();

    console.log(`✅ 当前主题: ${this.currentColorTheme} (${this.currentMode}模式)`);
  }

  /**
   * 从 localStorage 加载主题设置
   */
  loadThemeFromStorage() {
    const savedColorTheme = localStorage.getItem('theme-color');
    const savedMode = localStorage.getItem('theme-mode');

    if (savedColorTheme && this.themes.colors.find(t => t.id === savedColorTheme)) {
      this.currentColorTheme = savedColorTheme;
    }

    if (savedMode && this.themes.modes.find(m => m.id === savedMode)) {
      this.currentMode = savedMode;
    }
  }

  /**
   * 保存主题设置到 localStorage
   */
  saveThemeToStorage() {
    localStorage.setItem('theme-color', this.currentColorTheme);
    localStorage.setItem('theme-mode', this.currentMode);
  }

  /**
   * 应用主题到页面
   */
  applyTheme() {
    const html = document.documentElement;

    console.log(`🎨 应用主题: ${this.currentColorTheme} (${this.currentMode}模式)`);

    // 移除所有主题class
    this.themes.colors.forEach(theme => {
      if (theme.class) html.classList.remove(theme.class);
    });
    this.themes.modes.forEach(mode => {
      if (mode.class) html.classList.remove(mode.class);
    });

    // 添加当前主题class
    const colorTheme = this.themes.colors.find(t => t.id === this.currentColorTheme);
    const modeTheme = this.themes.modes.find(m => m.id === this.currentMode);

    if (colorTheme && colorTheme.class) {
      html.classList.add(colorTheme.class);
      console.log(`  ✅ 添加颜色主题类: ${colorTheme.class}`);
    } else {
      console.log(`  ℹ️ 使用默认颜色主题（无class）`);
    }

    if (modeTheme && modeTheme.class) {
      html.classList.add(modeTheme.class);
      console.log(`  ✅ 添加模式类: ${modeTheme.class}`);
    } else {
      console.log(`  ℹ️ 使用浅色模式（无class）`);
    }

    // 保存到 localStorage
    this.saveThemeToStorage();

    // 更新UI状态
    if (this.updateUI) {
      this.updateUI();
    }

    // 触发自定义事件，通知其他组件主题已更改
    window.dispatchEvent(new CustomEvent('themeChanged', {
      detail: {
        color: this.currentColorTheme,
        mode: this.currentMode
      }
    }));
  }

  /**
   * 切换颜色主题
   */
  setColorTheme(themeId) {
    if (this.themes.colors.find(t => t.id === themeId)) {
      this.currentColorTheme = themeId;
      this.applyTheme();
      console.log(`🎨 切换颜色主题: ${themeId}`);
    }
  }

  /**
   * 切换深色/浅色模式
   */
  setMode(modeId) {
    if (this.themes.modes.find(m => m.id === modeId)) {
      this.currentMode = modeId;
      this.applyTheme();
      console.log(`🌓 切换模式: ${modeId}`);
    }
  }

  /**
   * 切换深色/浅色模式（toggle）
   */
  toggleMode() {
    this.currentMode = this.currentMode === 'light' ? 'dark' : 'light';
    this.applyTheme();
  }

  /**
   * 创建主题切换UI
   */
  createThemeSwitcher() {
    // 检查是否已存在
    if (document.getElementById('theme-switcher')) return;

    const switcher = document.createElement('div');
    switcher.id = 'theme-switcher';
    switcher.className = 'fixed bottom-6 right-6 z-50';
    switcher.style.cssText = 'position: fixed; bottom: 24px; right: 24px; z-index: 9999;';
    switcher.innerHTML = `
      <!-- 主题切换按钮 -->
      <button id="theme-toggle-btn"
              class="bg-white dark:bg-gray-800 p-3 rounded-full shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-110"
              style="background: rgb(var(--bg-base)); padding: 12px; border-radius: 50%; box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1); transition: all 0.3s; border: none; cursor: pointer;"
              title="主题设置"
              onmouseover="this.style.transform='scale(1.1)'"
              onmouseout="this.style.transform='scale(1)'">
        <svg style="width: 24px; height: 24px; color: rgb(var(--text-primary));" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
        </svg>
      </button>

      <!-- 主题选择面板 -->
      <div id="theme-panel" class="hidden absolute bottom-16 right-0 bg-white dark:bg-gray-800 rounded-lg shadow-2xl p-4 w-80 animate-fade-in"
           style="display: none; position: absolute; bottom: 64px; right: 0; background: rgb(var(--bg-base)); border-radius: 12px; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1); padding: 16px; width: 320px; color: rgb(var(--text-primary));">
        <div class="mb-4">
          <h3 class="text-sm font-semibold mb-3 flex items-center">
            <svg class="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
            </svg>
            模式选择
          </h3>
          <div class="flex gap-2">
            <button data-mode="light" class="mode-btn flex-1 px-3 py-2 rounded-lg border-2 transition-all">
              <svg class="w-5 h-5 mx-auto mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
              <span class="text-xs">浅色</span>
            </button>
            <button data-mode="dark" class="mode-btn flex-1 px-3 py-2 rounded-lg border-2 transition-all">
              <svg class="w-5 h-5 mx-auto mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
              </svg>
              <span class="text-xs">深色</span>
            </button>
          </div>
        </div>

        <div>
          <h3 class="text-sm font-semibold mb-3 flex items-center">
            <svg class="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
            </svg>
            主题颜色
          </h3>
          <div class="grid grid-cols-5 gap-2">
            ${this.themes.colors.map(theme => `
              <button data-theme="${theme.id}"
                      class="theme-color-btn w-10 h-10 rounded-lg transition-all hover:scale-110"
                      style="background: ${theme.color};"
                      title="${theme.name}">
                <svg class="w-5 h-5 mx-auto text-white hidden" fill="currentColor" viewBox="0 0 20 20">
                  <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
                </svg>
              </button>
            `).join('')}
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(switcher);

    // 绑定事件
    this.bindEvents();
  }

  /**
   * 绑定事件
   */
  bindEvents() {
    // 切换面板显示
    const toggleBtn = document.getElementById('theme-toggle-btn');
    const panel = document.getElementById('theme-panel');

    toggleBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      const isHidden = panel.style.display === 'none' || panel.classList.contains('hidden');
      panel.style.display = isHidden ? 'block' : 'none';
      panel.classList.toggle('hidden');
      console.log('🎨 主题面板', isHidden ? '打开' : '关闭');
    });

    // 点击外部关闭面板
    document.addEventListener('click', (e) => {
      if (!panel?.contains(e.target) && e.target !== toggleBtn) {
        panel.style.display = 'none';
        panel?.classList.add('hidden');
      }
    });

    // 模式切换按钮
    document.querySelectorAll('.mode-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const mode = e.currentTarget.dataset.mode;
        this.setMode(mode);
        this.updateUI();
      });
    });

    // 颜色主题切换按钮
    document.querySelectorAll('.theme-color-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const theme = e.currentTarget.dataset.theme;
        this.setColorTheme(theme);
        this.updateUI();
      });
    });

    // 初始UI状态
    this.updateUI();
  }

  /**
   * 更新UI状态（高亮当前选中的主题）
   */
  updateUI() {
    // 更新模式按钮
    document.querySelectorAll('.mode-btn').forEach(btn => {
      const isActive = btn.dataset.mode === this.currentMode;
      if (isActive) {
        btn.classList.add('border-primary', 'bg-primary/10');
        btn.style.borderColor = `rgb(var(--color-primary))`;
      } else {
        btn.classList.remove('border-primary', 'bg-primary/10');
        btn.style.borderColor = `rgb(var(--border-color))`;
      }
    });

    // 更新颜色主题按钮
    document.querySelectorAll('.theme-color-btn').forEach(btn => {
      const isActive = btn.dataset.theme === this.currentColorTheme;
      const svg = btn.querySelector('svg');
      if (svg) {
        svg.classList.toggle('hidden', !isActive);
      }
      if (isActive) {
        btn.style.transform = 'scale(1.1)';
        btn.style.boxShadow = 'var(--shadow-lg)';
      } else {
        btn.style.transform = '';
        btn.style.boxShadow = '';
      }
    });
  }

  /**
   * 获取当前主题信息
   */
  getCurrentTheme() {
    return {
      color: this.currentColorTheme,
      mode: this.currentMode,
      colorName: this.themes.colors.find(t => t.id === this.currentColorTheme)?.name,
      modeName: this.themes.modes.find(m => m.id === this.currentMode)?.name
    };
  }
}

// 页面加载完成后自动初始化（延迟确保Tailwind已加载）
if (typeof window !== 'undefined') {
  // 使用load事件而不是DOMContentLoaded，确保所有资源（包括Tailwind CDN）都已加载
  window.addEventListener('load', () => {
    setTimeout(() => {
      window.themeManager = new ThemeManager();
      console.log('✅ 主题管理器已加载');
    }, 100);
  });

  // 提供手动初始化方法
  window.initThemeManager = function() {
    if (!window.themeManager) {
      window.themeManager = new ThemeManager();
    }
  };
}

// 导出（如果使用模块化）
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ThemeManager;
}
