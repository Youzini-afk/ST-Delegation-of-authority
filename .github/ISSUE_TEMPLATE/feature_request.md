name: 功能建议
about: 建议一个新能力或改动
labels: enhancement
body:
  - type: textarea
    id: proposal
    attributes:
      label: 建议内容
      description: 想要什么、解决什么问题
    validations:
      required: true
  - type: textarea
    id: downstream
    attributes:
      label: 下游使用场景（如适用）
      description: 若你是在下游 fork 中消费本仓，请说明你的仓库与使用的 API 面
