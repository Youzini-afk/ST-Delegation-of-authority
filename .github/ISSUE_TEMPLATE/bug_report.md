name: Bug 报告
about: 报告一个问题
labels: bug
body:
  - type: textarea
    id: what-happened
    attributes:
      label: 问题现象
      description: 发生了什么、期望是什么
    validations:
      required: true
  - type: textarea
    id: repro
    attributes:
      label: 复现步骤
      description: 最小复现步骤/配置
    validations:
      required: true
  - type: input
    id: version
    attributes:
      label: 版本
      description: SillyTavern 版本 / 本仓版本或提交号
  - type: textarea
    id: logs
    attributes:
      label: 日志
      render: shell
