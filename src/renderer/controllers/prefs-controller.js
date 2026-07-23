const { dispatch } = require('../lib/dispatcher')
const api = require('../lib/api')

// Controls the Preferences screen
module.exports = class PrefsController {
  constructor (state, config) {
    this.state = state
    this.config = config
  }

  // Goes to the Preferences screen
  show () {
    const state = this.state
    state.location.go({
      url: 'preferences',
      setup (cb) {
        // initialize preferences
        state.window.title = 'Preferences'
        api.menu.setAllowNavigation(false)
        cb()
      },
      destroy: () => {
        api.menu.setAllowNavigation(true)
      }
    })
  }

  // Updates a single property in the saved prefs
  // For example: updatePreferences('isFileHandler', true)
  update (property, value) {
    if (property === 'isFileHandler') api.handlers.setDefault(value)
    else if (property === 'startup') api.handlers.setStartup(value)

    this.state.saved.prefs[property] = value
    dispatch('stateSaveImmediate')
    dispatch('checkDownloadPath')
  }
}
