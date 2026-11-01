'use strict';
/* =====================================================================
   Language switch (English / 中文)
   PawTime is written in English. This file adds a Chinese version WITHOUT touching the app's logic:
   it watches the page and swaps every English sentence it knows for its Chinese translation
   (text, placeholders, aria-labels, tooltips, toasts and confirm boxes). The English text is kept,
   so switching back is instant. Text it does not know (your pet's name, notes, sticker captions) is never changed.

   To add or fix a translation: edit DICT (exact sentences) or RULES (sentences with numbers in them).
   ===================================================================== */
(() => {
  const KEY = 'pawtime-lang';
  let lang = 'en';
  try {
    const saved = localStorage.getItem(KEY);
    lang = saved || ((navigator.language || '').toLowerCase().startsWith('zh') ? 'zh' : 'en');
  } catch (e) { /* storage blocked: stay with the browser language */ if ((navigator.language || '').toLowerCase().startsWith('zh')) lang = 'zh'; }

  /* ---------- exact sentences ---------- */
  const DICT = {
    // top bar, tabs, camera
    'Camera': '相机', 'Timeline': '时间线', 'Journey': '旅程', 'My pet': '我的宠物', 'Settings': '设置', 'Close': '关闭',
    'Pet profile and settings': '宠物资料和设置', 'Camera mode': '相机模式', 'Switch camera': '切换摄像头', 'Take photo': '拍照',
    'Start or stop recording': '开始或停止录像', 'Open timeline': '打开时间线', 'Growth timeline': '成长时间线', 'Journey overview': '旅程总览',
    'Burst takes 5 quick photos': '连拍：一次快速拍 5 张', 'Burst: off': '连拍：关', 'Burst: on': '连拍：开', 'Flip ⟲': '翻转 ⟲',
    'Photo': '照片', 'Video': '视频', 'Tag this moment': '给这个瞬间打标签',
    'Burst on: each tap takes 5 photos': '连拍已开启：每次点击拍 5 张', 'Burst off': '连拍已关闭',
    'Try the camera again': '重新打开相机', 'Choose photos from my gallery': '从相册选择照片', 'Use sample pet photos': '使用示例宠物照片',
    'Camera not available here': '这里无法使用相机',
    'Browsers only allow the camera on secure (https) pages. Open the https link, or use your gallery or the sample photos instead.': '浏览器只允许在安全（https）网页上使用相机。请打开 https 链接，或改用相册或示例照片。',
    'This browser cannot open the camera. You can still add photos from your gallery or try the sample photos.': '这个浏览器无法打开相机。你仍然可以从相册添加照片，或试试示例照片。',
    'Camera permission was denied': '相机权限被拒绝了',
    'PawTime needs the camera to shoot. Allow it in your browser or phone settings, then try again. Or add photos from your gallery instead.': 'PawTime 需要相机才能拍摄。请在浏览器或手机设置里允许，然后重试；或者改为从相册添加照片。',
    'No camera found': '没有找到相机',
    'This device has no camera PawTime can use. Add photos from your gallery, or try the sample photos.': '这台设备没有 PawTime 可用的相机。请从相册添加照片，或试试示例照片。',
    'Camera is busy': '相机正忙',
    'Another app may be using the camera. Close it and try again.': '可能有别的应用正在使用相机。关闭它后再试。',
    'Could not start the camera': '无法启动相机', 'Something went wrong.': '出了点问题。',
    'Camera is not ready yet': '相机还没准备好', 'Camera is not ready. Use the options on screen.': '相机还没准备好，请使用屏幕上的选项。',
    'Saved ✓': '已保存 ✓',
    'This browser cannot record video. Choose a video from your gallery instead.': '这个浏览器无法录像，请改为从相册选择视频。',
    'No microphone access, so this clip has no sound.': '没有麦克风权限，所以这段视频没有声音。',
    'That clip was too short to save.': '这段视频太短，无法保存。',
    'This video could not be read here.': '这里无法读取这个视频。', 'This video format cannot be read by this browser.': '这个浏览器无法读取这种视频格式。',
    'This file is not an image I can read.': '这个文件不是我能读取的图片。',
    'No images selected. Pick photo or video files (JPG, PNG, MP4, MOV, WebM).': '没有选择文件。请选择照片或视频文件（JPG、PNG、MP4、MOV、WebM）。',
    'Those files could not be read as photos or videos.': '这些文件无法作为照片或视频读取。',
    'Those files could not be read as images.': '这些文件无法作为图片读取。',
    // tags
    'Eating': '吃饭', 'Sleeping': '睡觉', 'Walk': '散步', 'Silly': '搞怪', 'Milestone': '里程碑', 'First memory': '第一份回忆', 'All': '全部',
    '100th photo': '第 100 张照片', '250th photo': '第 250 张照片', '500th photo': '第 500 张照片', '1000th photo': '第 1000 张照片',
    // onboarding
    'Who are we remembering?': '我们要记录谁？',
    'Their birthday lets the timeline show age and “Day N”. You can skip this and add it later.': '填写生日后，时间线会显示年龄和“第 N 天”。也可以先跳过，以后再填。',
    "Pet's name": '宠物名字', 'e.g. Mochi': '例如：年糕', 'Birthday (optional)': '生日（可选）', 'Start capturing': '开始记录', 'Skip for now': '先跳过',
    // timeline
    'Tap a stack to open it. Nothing is ever deleted automatically.': '点一摞照片就能打开。绝不会自动删除任何照片。',
    'Filter by tag': '按标签筛选', 'Jump to date': '跳到日期',
    'Your timeline is empty.': '你的时间线还是空的。',
    'Shoot a photo in the Camera tab and it will appear here, already organised.': '在“相机”里拍一张照片，它就会自动整理好出现在这里。',
    'Try it with sample pet photos': '用示例宠物照片试试', 'No moments have this tag yet.': '还没有带这个标签的瞬间。', 'Show everything': '显示全部',
    'Tap to remember it.': '点开回忆一下。', 'Sticker': '贴纸', 'sticker': '贴纸', 'Moment': '瞬间',
    'Days since birthday': '出生以来的天数', 'Days since the first memory': '第一份回忆以来的天数',
    'Nothing on the timeline to jump to yet.': '时间线上还没有内容可以跳转。', 'Jumped to that day': '已跳到那一天',
    'Nothing on or before that date. Showing your earliest day.': '这个日期及之前没有内容，已显示最早的一天。',
    'No photos that day. Showing the nearest earlier day.': '那天没有照片，已显示最近的前一天。',
    // viewer
    'Tags for this moment': '这个瞬间的标签', 'Stickers are not tagged.': '贴纸不能打标签。',
    '✨ Make a sticker from this photo': '✨ 用这张照片做贴纸', '⭐ Use this photo as the cover': '⭐ 把这张设为封面', '⤴ Share / Download': '⤴ 分享 / 下载',
    '✂ This one is different: take it out of the stack': '✂ 这张不一样：把它从这摞里拿出来',
    'Cover updated ✓': '封面已更新 ✓', 'Taken out of the stack ✓': '已从这摞里拿出来 ✓', 'Tidied up ✓': '整理好了 ✓', 'Deleted': '已删除',
    'Cover: your pick': '封面：你选的', 'Cover: auto-picked as the sharpest shot': '封面：自动选了最清晰的一张', 'Cover': '封面',
    'Shared ✓': '已分享 ✓', 'Sharing is not supported here, so it was downloaded instead ✓': '这里不支持分享，已改为下载 ✓',
    // choose what to keep
    'Similar photos': '相似照片', 'Tick all': '全选', 'Skip': '跳过', 'Cancel': '取消', 'Keep all': '全部保留', 'Tick at least one': '至少勾选一张',
    'Tap the photos you want to keep. The ticked ones stay, the rest are deleted when you press the button.': '点选想保留的照片。打钩的留下，按下按钮后其余的会被删除。',
    'All tidy ✓': '全部整理好了 ✓',
    // journey
    'All time': '全部时间', 'Years': '年份', 'Months': '月份', '⭐ Milestones': '⭐ 里程碑', 'Birthday': '生日', '🎂 Birthday!': '🎂 生日快乐！',
    'Your journey starts with the first photo.': '你的旅程从第一张照片开始。', 'Years, months and days will build up here.': '年、月、日会在这里一点点积累起来。',
    'Days (tap one to open it on the timeline)': '日期（点一天，在时间线上打开）', 'Photos per month': '每月照片数',
    'photos': '张照片', 'moments': '个瞬间', 'days': '天', 'stickers': '张贴纸', 'Your pet’s journey': '宠物的旅程',
    'January': '1月', 'February': '2月', 'March': '3月', 'April': '4月', 'June': '6月', 'July': '7月', 'August': '8月', 'September': '9月', 'October': '10月', 'November': '11月', 'December': '12月', 'May': '5月',
    // settings
    'Pet profile': '宠物资料', 'Name': '名字', 'Smart folding': '智能折叠',
    'Photos taken close together that look alike are folded into one “moment”. Nothing is deleted.': '时间相近且看起来相似的照片会折叠成一个“瞬间”。不会删除任何照片。',
    'Similarity': '相似度', 'Time window': '时间窗口', 'balanced': '适中', 'very strict': '很严格', 'very loose': '很宽松',
    'Take or add some photos to see the effect here.': '拍几张或添加几张照片，就能在这里看到效果。',
    'Data': '数据', "Everything is stored only on this device (in the app's own storage, not your phone gallery).": '所有内容只保存在这台设备上（保存在 App 自己的存储里，不在手机相册中）。',
    'Add sample pet photos': '添加示例宠物照片', 'Remove sample photos': '移除示例照片', 'Export backup (.json)': '导出备份（.json）', 'Delete all data': '删除所有数据',
    'Nothing to export yet.': '还没有可导出的内容。', 'Preparing backup…': '正在准备备份…', 'Backup downloaded ✓': '备份已下载 ✓',
    'There are no sample photos to remove.': '没有可移除的示例照片。', 'Sample photos removed ✓': '示例照片已移除 ✓', 'All data deleted': '所有数据已删除',
    'Delete ALL photos, stickers and settings from this device? This cannot be undone.': '要从这台设备上删除所有照片、贴纸和设置吗？此操作无法撤销。',
    'Storage is unavailable in this browser mode: photos will be lost when you close the app.': '这个浏览器模式下无法使用存储：关闭 App 后照片会丢失。',
    // sticker studio
    'Sticker Studio': '贴纸工坊', 'Reset': '重置', 'Sticker preview': '贴纸预览', 'Save to timeline': '保存到时间线', 'Share / Download': '分享 / 下载',
    'Text': '文字', 'Emoji': '表情', 'Draw': '绘画', 'Card': '卡片', 'Frame': '形状', 'Border colour': '边框颜色', 'Border width': '边框粗细',
    'Extra outer line': '额外外圈线', 'Photo zoom': '照片缩放', 'Tip: drag the photo to re-position it.': '提示：拖动照片可以调整位置。',
    'Circle': '圆形', 'Oval': '椭圆', 'Rounded': '圆角', 'Heart': '爱心', 'Star': '星星', 'Burst': '爆炸星', 'Badge': '徽章',
    'Sparkle': '闪光', 'Bubble': '气泡', 'Paw': '爪印', 'Cloud': '云朵', 'Flower': '小花',
    'Pop': '波普', 'Cute': '可爱', 'Meme': '表情包', 'Script': '手写', 'Plain': '普通', 'Decorations': '装饰',
    'Tap a style to add text, then type your own and drag it where you want. Add as many as you like.': '点一种风格添加文字，然后输入你自己的内容并拖到想要的位置。想加几个都可以。',
    'Size': '大小', 'Rotate': '旋转', 'Duplicate': '复制', 'To front': '置顶', 'Delete': '删除', 'Moved to front': '已置顶',
    'Marker': '马克笔', 'Pen': '画笔', 'Neon': '霓虹笔', 'Eraser': '橡皮', 'Thickness': '粗细', 'Undo line': '撤销一笔', 'Clear all lines': '清除所有线条',
    'Draw with your finger. Neon makes glowing lines. Eraser removes a whole line when you touch it.': '用手指画画。霓虹笔会画出发光的线，橡皮碰到哪条线就擦掉整条。',
    'Sticker (see-through)': '贴纸（透明背景）', 'Card (pattern background)': '卡片（图案背景）', 'Pattern': '图案', 'Colours': '配色',
    'Halftone': '圆点', 'Gingham': '格子', 'Plaid': '苏格兰格', 'Sun rays': '太阳光芒', 'Stripes': '条纹', 'Stars': '星星', 'Gradient': '渐变', 'Solid': '纯色',
    'A card gives your sticker a printed look: choose a pattern and colours. Switch back to Sticker for a see-through background.': '卡片会让贴纸有印刷品的感觉：选一个图案和配色。想要透明背景就切回“贴纸”。',
    '✂️ Cut out my pet automatically': '✂️ 自动抠出我的宠物', 'Removes the background and adds a sticker outline.': '去掉背景并加上贴纸描边。',
    'Finding your pet…': '正在找到你的宠物…', 'The first time takes a few seconds while the cut-out model loads. Everything stays on your phone.': '第一次需要几秒钟加载抠图模型。所有内容都留在你的手机上。',
    'Outline style': '描边样式', 'No outline': '无描边', 'Double': '双层', 'Neon glow': '霓虹发光', 'Glow colour': '发光颜色', 'Inner colour': '内圈颜色', 'Outer colour': '外圈颜色', 'Outline colour': '描边颜色',
    'Outline width': '描边粗细', 'Soft shadow': '柔和阴影', '🖌 Fix the edges': '🖌 修补边缘', '↻ Cut again': '↻ 重新抠图', 'Undo cut-out': '撤销抠图',
    '➕ Add back': '➕ 补回', '➖ Erase': '➖ 擦掉', 'Brush size': '笔刷大小', 'Undo': '撤销', 'Done': '完成',
    'Paint over the picture with your finger. “Erase” removes background that was left on, “Add back” restores a part that was cut off.': '用手指在图片上涂抹。“擦掉”去除残留的背景，“补回”恢复被切掉的部分。',
    'I could not find the pet in this photo. Try one with a plainer background.': '这张照片里没找到宠物。换一张背景更简单的试试。',
    'WebAssembly SIMD is not available in this browser': '这个浏览器不支持 WebAssembly SIMD',
    'Sticker reset': '贴纸已重置', 'Start over? This clears everything you added to the sticker.': '要重新开始吗？这会清除你给贴纸添加的所有内容。',
    'Close without saving this sticker?': '不保存这张贴纸就关闭吗？', 'Sticker saved to your timeline ✓': '贴纸已保存到时间线 ✓',
    // sample photos
    'There are no sample photos to remove.x': '',
  };
  /* sentences whose English is built from several parts ("Made with: …") */
  const METHOD = {
    'AI model running on your phone': 'AI 模型（在你的手机上运行）',
    'quick colour-based cut-out (the AI model is not available here)': '快速颜色抠图（这里无法使用 AI 模型）',
  };
  const MON = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Sept: 9, Oct: 10, Nov: 11, Dec: 12 };
  const WEEK = { Mon: '周一', Tue: '周二', Wed: '周三', Thu: '周四', Fri: '周五', Sat: '周六', Sun: '周日' };
  const NOUN = { photo: '张照片', moment: '个瞬间', stack: '摞', video: '个视频', day: '天', sticker: '张贴纸', file: '个文件', year: '年', 'extra shot': '张多余的照片' };
  const cnt = (n, w) => `${n} ${NOUN[w]}`;
  const noun = (w) => w.replace(/s$/, '');
  const age = (s) => {                                    // "2 yrs 7 mos old", "9 mos old", "5 days old", "2 mos"
    const m = /^(?:(\d+) yrs?)?\s*(?:(\d+) mos?)?\s*(?:(\d+) days?)?\s*(old)?$/.exec(s);
    if (!m || (!m[1] && !m[2] && !m[3])) return null;
    return (m[1] ? m[1] + '岁' : '') + (m[2] ? m[2] + '个月' : '') + (m[3] ? m[3] + (m[4] ? '天大' : '天') : '');
  };
  const dateZh = (s) => {                                 // "Thu, 29 Oct 2026" / "Thu 29 Oct 2026"
    const m = /^(?:(Mon|Tue|Wed|Thu|Fri|Sat|Sun),?\s+)?(\d{1,2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sept?|Oct|Nov|Dec) (\d{4})$/.exec(s);
    return m ? `${m[4]}年${MON[m[3]]}月${m[2]}日${m[1] ? ' ' + WEEK[m[1]] : ''}` : null;
  };
  const monthYearZh = (s) => {                            // "October 2026"
    const names = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const m = /^([A-Z][a-z]+) (\d{4})$/.exec(s); const i = m ? names.indexOf(m[1]) : -1;
    return i >= 0 ? `${m[2]}年${i + 1}月` : null;
  };

  /* ---------- sentences with numbers ---------- */
  const RULES = [
    [/^(\d+) (photos?|moments?|stacks?|videos?|days?|stickers?|files?|years?|extra shots?)$/, (m) => cnt(m[1], noun(m[2]))],
    [/^(\d+) photos? folded into (\d+) moments?$/, (m) => `${m[1]} 张照片折叠成 ${m[2]} 个瞬间`],
    [/^(\d+) photos? in (\d+) moments?$/, (m) => `${m[1]} 张照片，${m[2]} 个瞬间`],
    [/^(\d+) min$/, (m) => `${m[1]} 分钟`],
    [/^Day (\d+)$/, (m) => `第 ${m[1]} 天`],
    [/^Moment of (\d+) photos?$/, (m) => `${m[1]} 张照片的瞬间`],
    [/^Moment$/, () => '瞬间'],
    [/^(\d+) similar photos$/, (m) => `${m[1]} 张相似照片`],
    [/^Keep (\d+), delete (\d+)$/, (m) => `保留 ${m[1]} 张，删除 ${m[2]} 张`],
    [/^Keep (\d+)$/, (m) => `保留 ${m[1]} 张`],
    [/^Kept (\d+), deleted (\d+) ✓$/, (m) => `已保留 ${m[1]} 张，删除 ${m[2]} 张 ✓`],
    [/^Saved (\d+) photos ✓$/, (m) => `已保存 ${m[1]} 张照片 ✓`],
    [/^Video saved ✓ \((.+)\)$/, (m) => `视频已保存 ✓（${m[1]}）`],
    [/^Added (\d+) files? ✓$/, (m) => `已添加 ${m[1]} 个文件 ✓`],
    [/^Added (\d+) photos? ✓$/, (m) => `已添加 ${m[1]} 张照片 ✓`],
    [/^Added (\d+), skipped (\d+) unreadable file\(s\)\.$/, (m) => `已添加 ${m[1]} 个，跳过 ${m[2]} 个无法读取的文件。`],
    [/^Adding… (\d+)\/(\d+)$/, (m) => `正在添加… ${m[1]}/${m[2]}`],
    [/^Adding photos… (\d+)\/(\d+)$/, (m) => `正在添加照片… ${m[1]}/${m[2]}`],
    [/^Making sample photos… (\d+)\/(\d+)$/, (m) => `正在生成示例照片… ${m[1]}/${m[2]}`],
    [/^Added (\d+) sample photos\. Notice how similar shots fold into stacks ✓$/, (m) => `已添加 ${m[1]} 张示例照片。看看相似的照片是怎么折叠成一摞的 ✓`],
    [/^Could not (save the photo|save the video|save the sticker|share|open that photo|start recording|create sample photos|read saved photos|encode image): (.*)$/s, (m) => `${{ 'save the photo': '无法保存照片', 'save the video': '无法保存视频', 'save the sticker': '无法保存贴纸', share: '无法分享', 'open that photo': '无法打开这张照片', 'start recording': '无法开始录像', 'create sample photos': '无法生成示例照片', 'read saved photos': '无法读取已保存的照片', 'encode image': '无法编码图片' }[m[1]]}：${m[2]}`],
    [/^Backup failed: (.*)$/s, (m) => `备份失败：${m[1]}`],
    [/^On this day, (\d+) years? ago$/, (m) => `${m[1]} 年前的今天`],
    [/^This month: (\d+) moments?$/, (m) => `本月：${m[1]} 个瞬间`],
    [/^Your biggest one has (\d+) photos?\. Tap to open\.$/, (m) => `最大的一个有 ${m[1]} 张照片。点开看看。`],
    [/^(\d+) stacks? of similar photos$/, (m) => `${m[1]} 摞相似照片`],
    [/^(\d+) extra shots? you could clear\. Tap to choose what to keep\.$/, (m) => `有 ${m[1]} 张多余的照片可以清理。点开选择要保留的。`],
    [/^Tap the photos you want to keep\. The ticked ones stay, the rest are deleted when you press the button\. \((\d+) more stacks to look at afterwards\.\)$/, (m) => `点选想保留的照片。打钩的留下，按下按钮后其余的会被删除。（之后还有 ${m[1]} 摞可以看。）`],
    [/^☑ Choose which of these (\d+) to keep$/, (m) => `☑ 从这 ${m[1]} 张里选择要保留的`],
    [/^🧹 Keep only the cover, delete (\d+) others$/, (m) => `🧹 只保留封面，删除其余 ${m[1]} 张`],
    [/^🗑 Delete this (photo|sticker|video)$/, (m) => `🗑 删除这${{ photo: '张照片', sticker: '张贴纸', video: '个视频' }[m[1]]}`],
    [/^Delete this (photo|sticker|video)\? This cannot be undone\.$/, (m) => `要删除这${{ photo: '张照片', sticker: '张贴纸', video: '个视频' }[m[1]]}吗？此操作无法撤销。`],
    [/^Delete (\d+) photos? and keep only the cover\? This cannot be undone\.$/, (m) => `要删除 ${m[1]} 张照片，只保留封面吗？此操作无法撤销。`],
    [/^Delete (\d+) photos? and keep (\d+)\? This cannot be undone\.$/, (m) => `要删除 ${m[1]} 张照片，保留 ${m[2]} 张吗？此操作无法撤销。`],
    [/^Right now: (\d+) photos? → (\d+) moments?\.$/, (m) => `目前：${m[1]} 张照片 → ${m[2]} 个瞬间。`],
    [/^(.*)’s journey$/, (m) => `${m[1]} 的旅程`],
    [/^(.+) at the latest photo$/, (m) => `最新照片时 ${age(m[1]) || m[1]}`],
    [/^Since (.+)$/, (m) => `自 ${dateZh(m[1]) || m[1]} 起`],
    [/^Made with: (.*)\.$/s, (m) => `制作方式：${METHOD[m[1]] || m[1]}。`],
    [/^Drag to move the pet, pinch to resize\.$/, () => '拖动可以移动宠物，双指捏合可以缩放。'],
    [/^Photo at (\d{2}:\d{2})$/, (m) => `${m[1]} 的照片`],
    [/^Pet photo taken (.+)$/, (m) => `${dateZh(m[1]) || m[1]} 拍的宠物照片`],
    [/^(.+): (\d+) photos$/, (m) => `${m[1]}：${m[2]} 张照片`],
    [/^Colour (#[0-9a-f]{3,6})$/i, (m) => `颜色 ${m[1]}`],
    [/^Colours (#[0-9a-f]{3,6}) and (#[0-9a-f]{3,6})$/i, (m) => `配色 ${m[1]} 和 ${m[2]}`],
  ];

  function tr1(s) {                                       // translate one piece (no " · " or " → " inside)
    if (DICT[s] !== undefined && DICT[s] !== '') return DICT[s];
    for (const [re, f] of RULES) { const m = re.exec(s); if (m) return f(m); }
    const e = /^([^A-Za-z0-9\s]+)\s+([A-Za-z].*)$/.exec(s);     // "🍖 Eating", "⭐ Milestone · 2"
    if (e) { const r = tr1(e[2]); if (r !== null) return e[1] + ' ' + r; }
    return dateZh(s) || monthYearZh(s) || age(s) || null;
  }
  function tr(raw) {
    const lead = /^\s*/.exec(raw)[0], trail = /\s*$/.exec(raw)[0], core = raw.trim();
    if (!core || !/[A-Za-z]/.test(core)) return raw;
    let out = tr1(core);
    if (out === null) {
      let hit = false;
      const split = (str, sep) => str.split(sep).map((part) => {
        const t = part.trim(); const lp = /^\s*/.exec(part)[0], tp = /\s*$/.exec(part)[0];
        let r = tr1(t);
        if (r === null && sep === ' · ' && t.includes(' → ')) r = split(t, ' → ');
        if (r === null) return part;
        hit = true; return lp + r + tp;
      }).join(sep);
      out = split(core, ' · ');
      if (!hit && core.includes(' → ')) out = split(core, ' → ');
      if (!hit) return raw;
    }
    return lead + out + trail;
  }

  /* ---------- keep English and Chinese side by side, and swap ---------- */
  const ATTRS = ['placeholder', 'aria-label', 'title', 'alt'];
  const origText = new WeakMap(), shownText = new WeakMap(), origAttr = new WeakMap(), shownAttr = new WeakMap();
  let busy = false;

  function doText(n) {
    const cur = n.nodeValue;
    if (cur !== shownText.get(n)) origText.set(n, cur);       // the app wrote new English: remember it
    const en = origText.get(n); if (en === undefined) return;
    const out = lang === 'zh' ? tr(en) : en;
    shownText.set(n, out);
    if (out !== cur) n.nodeValue = out;
  }
  function doAttrs(el) {
    if (el.nodeType !== 1 || el.hasAttribute('data-no-i18n')) return;
    for (const a of ATTRS) {
      if (!el.hasAttribute(a)) continue;
      let o = origAttr.get(el), s = shownAttr.get(el);
      if (!o) { o = {}; s = {}; origAttr.set(el, o); shownAttr.set(el, s); }
      const cur = el.getAttribute(a);
      if (cur !== s[a]) o[a] = cur;
      const out = lang === 'zh' ? tr(o[a]) : o[a];
      s[a] = out;
      if (out !== cur) el.setAttribute(a, out);
    }
  }
  function walk(root) {
    if (root.nodeType === 3) { if (!root.parentElement || !root.parentElement.closest('[data-no-i18n],script,style,textarea')) doText(root); return; }
    if (root.nodeType !== 1) return;
    if (root.closest('[data-no-i18n]') || /^(SCRIPT|STYLE)$/.test(root.tagName)) return;
    doAttrs(root);
    for (const c of root.childNodes) walk(c);
    for (const el of root.querySelectorAll ? root.querySelectorAll('[placeholder],[aria-label],[title],[alt]') : []) doAttrs(el);
  }
  const observer = new MutationObserver((list) => {
    if (busy) return;
    busy = true;
    try {
      for (const m of list) {
        if (m.type === 'characterData') walk(m.target);
        else if (m.type === 'attributes') doAttrs(m.target);
        else m.addedNodes.forEach(walk);
      }
    } finally { busy = false; observer.takeRecords(); }
  });
  function apply() {
    busy = true;
    try { walk(document.body); document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en'; } finally { busy = false; }
    observer.takeRecords();
    document.querySelectorAll('[data-lang-btn]').forEach((b) => { b.textContent = lang === 'zh' ? 'EN' : '中文'; });
  }
  function setLang(next) {
    lang = next;
    try { localStorage.setItem(KEY, lang); } catch (e) { /* ignore */ }
    apply();
  }

  /* confirm() boxes are plain browser dialogs, so translate their message too */
  const nativeConfirm = window.confirm.bind(window);
  window.confirm = (msg) => nativeConfirm(lang === 'zh' ? tr(String(msg)) : msg);

  document.addEventListener('click', (e) => { const b = e.target.closest('[data-lang-btn]'); if (b) setLang(lang === 'zh' ? 'en' : 'zh'); });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  apply();
  window.PawI18n = { setLang, getLang: () => lang, tr };
})();
