const fs = require('fs');
const path = require('path');
const config = require('../../config');

class SmartClassifier {
  constructor(db) {
    this.db = db;
    this.classifier = null;
    this.isTrained = false;
    this.BayesClassifier = null;
    this.config = config.plugins.smartClassification;
    this.modelPath = path.join(config.MODEL_DIR, 'classifier-model.json');
    this.queue = [];
    this.isProcessing = false;
  }

  async init() {
    if (!this.config.enabled) {
      console.log('[智能分类] 插件已禁用');
      return false;
    }

    console.log('[智能分类] 初始化中...');

    try {
      const naturalModule = await import('natural');
      const natural = naturalModule.default;
      this.BayesClassifier = natural.BayesClassifier;
      
      if (this.config.trainOnStartup) {
        await this._loadOrTrainModel();
      }

      this._startQueueProcessor();
      
      console.log('[智能分类] 初始化完成');
      return true;
    } catch (err) {
      console.error('[智能分类] 初始化失败:', err.message);
      return false;
    }
  }

  async _loadOrTrainModel() {
    if (fs.existsSync(this.modelPath)) {
      try {
        const modelData = JSON.parse(fs.readFileSync(this.modelPath, 'utf-8'));
        this.classifier = this.BayesClassifier.restore(modelData);
        this.isTrained = true;
        console.log('[智能分类] 已加载训练好的模型');
        return;
      } catch (err) {
        console.warn('[智能分类] 加载模型失败，将重新训练:', err.message);
      }
    }

    await this._trainDefaultModel();
  }

  async _trainDefaultModel() {
    console.log('[智能分类] 训练默认分类器...');

    this.classifier = new this.BayesClassifier();

    const trainingData = {
      '工作': [
        '会议 报告 项目 工作 任务 邮件 客户 公司 团队 领导 同事 会议纪要 工作计划 总结 汇报 业绩 指标 KPI',
        'product manager meeting report project task email client company team leader colleague work business work plan summary performance',
        '代码 编程 开发 测试 部署 运维 产品 需求 设计 架构 技术 方案',
        'code programming develop test deploy operation product requirement design architecture tech solution'
      ],
      '学习': [
        '学习 笔记 教程 文档 资料 课程 考试 作业 论文 研究 知识 复习 背诵',
        'learn study note tutorial doc course exam homework paper research knowledge',
        '数学 物理 化学 生物 历史 地理 英语 语文 数学 物理 化学',
        'math physics chemistry biology history geography english language'
      ],
      '娱乐': [
        '游戏 视频 音乐 电影 电视剧 综艺 音乐 歌曲 歌词 段子 笑话 梗图',
        'game video music movie tv show song lyrics joke meme funny',
        '旅游 美食 菜谱 食谱 烹饪 游戏攻略',
        'travel food recipe cook game guide walkthrough'
      ],
      '代码': [
        'function class var const let import export return if else for while switch try catch',
        'python java javascript typescript c++ golang rust sql database query',
        'import from import React Vue Angular Node npm pip install',
        'git commit push pull branch merge'
      ],
      '购物': [
        '淘宝 京东 拼多多 天猫 价格 优惠 折扣 优惠券 下单 支付 订单',
        'taobao jd pdd tmall price discount coupon order pay buy purchase',
        '价格 多少钱 价格表 购物车 结算',
        'price cost cart checkout shopping ecommerce amazon'
      ],
      '社交': [
        '微信 朋友圈 点赞 评论 转发 关注 粉丝 好友 聊天',
        'wechat moment like comment share follow friend chat message',
        '微博 抖音 小红书 知乎 快手',
        'weibo douyin xiaohongshu zhihu'
      ]
    };

    for (const [category, texts] of Object.entries(trainingData)) {
      texts.forEach(text => {
        this.classifier.addDocument(text, category);
      });
    }

    this.classifier.train();
    this.isTrained = true;

    this._saveModel();
    console.log('[智能分类] 默认分类器训练完成');
  }

  _saveModel() {
    try {
      if (this.classifier.save(this.modelPath));
    } catch (err) {
      console.warn('[智能分类] 保存模型失败:', err.message);
    }
  }

  classify(text) {
    if (!this.config.enabled || !this.isTrained) {
      return null;
    }

    try {
      const classifications = this.classifier.getClassifications(text);
      
      if (classifications.length > 0) {
        const best = classifications[0];
        if (best.value >= this.config.minConfidence) {
          return best.label;
        }
      }
    } catch (err) {
      return null;
    }
      
    return null;
  }

  classifyWithDetails(text) {
    if (!this.config.enabled || !this.isTrained) {
      return null;
    }

    try {
      return this.classifier.getClassifications(text);
    } catch (err) {
      return [];
    }
  }

  queueClassification(record) {
    if (!this.config.enabled || !this.config.autoClassify) {
      return;
    }

    this.queue.push(record);
  }

  onNewRecord(record) {
    if (record.type === 'text') {
      this.queueClassification(record);
    }
  }

  _startQueueProcessor() {
    setInterval(() => {
      this._processQueue();
    }, 1000);
  }

  async _processQueue() {
    if (this.queue.length === 0 || this.isProcessing || !this.isTrained) {
        return;
      }

    this.isProcessing = true;

    const batch = this.queue.splice(0, 10);

    for (const record of batch) {
      try {
        if (record.type === 'text') {
          const category = this.classify(record.content);
          if (category) {
            this.db.updateCategory(record.id, category);
          }
        }
      } catch (err) {
      }
    }

    this.isProcessing = false;
  }

  train(text, category) {
    if (this.classifier) {
      this.classifier.addDocument(text, category);
      this.classifier.train();
      this._saveModel();
    }
  }
}

module.exports = SmartClassifier;
