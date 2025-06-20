import antfu from '@antfu/eslint-config'

export default antfu({
  rules: {
    'no-console': 'off',
    'ts/method-signature-style': 'off',
    'style/multiline-ternary': 'off',
    'unicorn/prefer-node-protocol': 'off',
    'no-unreachable-loop': 'off',
    'ts/no-unsafe-function-type': 'off',
  },
})
