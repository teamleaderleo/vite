import { value } from 'virtual:plugin-state'

const state = document.querySelector('#state')
const watch = document.querySelector('#watch')
const updates = document.querySelector('#updates')

state.textContent = value
watch.textContent = 'pending'
updates.textContent = '0'

if (import.meta.hot) {
  import.meta.hot.on('fieldwork:watch-seen', () => {
    watch.textContent = 'seen'
  })
  import.meta.hot.on('fieldwork:state', ({ value }) => {
    state.textContent = value
    updates.textContent = String(Number(updates.textContent) + 1)
  })
}
