const React = require('react')
const PropTypes = require('prop-types')

const { Checkbox } = require('../components/controls')
const { RaisedButton } = require('../components/controls')
const { TextField } = require('../components/controls')
const Heading = require('../components/heading')
const PathSelector = require('../components/path-selector')

const { dispatch } = require('../lib/dispatcher')
const config = require('../lib/config')

class PreferencesPage extends React.Component {
  constructor (props) {
    super(props)

    this.handleDownloadPathChange =
      this.handleDownloadPathChange.bind(this)

    this.handleOpenExternalPlayerChange =
      this.handleOpenExternalPlayerChange.bind(this)

    this.handleExternalPlayerPathChange =
      this.handleExternalPlayerPathChange.bind(this)

    this.handleStartupChange =
      this.handleStartupChange.bind(this)

    this.handleSoundNotificationsChange =
      this.handleSoundNotificationsChange.bind(this)

    this.handleSetGlobalTrackers =
      this.handleSetGlobalTrackers.bind(this)

    const globalTrackers = this.props.state.getGlobalTrackers().join('\n')

    this.state = {
      globalTrackers
    }
  }

  downloadPathSelector () {
    return (
      <Preference>
        <PathSelector
          purpose='downloadPath'
          onChange={this.handleDownloadPathChange}
          title='Download location'
          value={this.props.state.saved.prefs.downloadPath}
        />
      </Preference>
    )
  }

  handleDownloadPathChange (filePath) {
    dispatch('updatePreferences', 'downloadPath', filePath)
  }

  openExternalPlayerCheckbox () {
    return (
      <Preference>
        <Checkbox
          className='control'
          checked={!this.props.state.saved.prefs.openExternalPlayer}
          label='Play torrent media files using WebTorrent'
          onCheck={this.handleOpenExternalPlayerChange}
        />
      </Preference>
    )
  }

  handleOpenExternalPlayerChange (e, isChecked) {
    dispatch('updatePreferences', 'openExternalPlayer', !isChecked)
  }

  highestPlaybackPriorityCheckbox () {
    return (
      <Preference>
        <Checkbox
          className='control'
          checked={this.props.state.saved.prefs.highestPlaybackPriority}
          label='Highest Playback Priority'
          onCheck={this.handleHighestPlaybackPriorityChange}
        />
        <p>Pauses other active torrents while playing. Bandwidth limits still apply.</p>
      </Preference>
    )
  }

  handleHighestPlaybackPriorityChange (e, isChecked) {
    dispatch('updatePreferences', 'highestPlaybackPriority', isChecked)
  }

  externalPlayerPathSelector () {
    const playerPath = this.props.state.saved.prefs.externalPlayerPath
    const playerName = this.props.state.getExternalPlayerName()

    const description = this.props.state.saved.prefs.openExternalPlayer
      ? `Torrent media files will always play in ${playerName}.`
      : `Torrent media files will play in ${playerName} if WebTorrent cannot play them.`

    return (
      <Preference>
        <p>{description}</p>
        <PathSelector
          purpose='externalPlayerPath'
          onChange={this.handleExternalPlayerPathChange}
          title='External player'
          value={playerPath}
        />
      </Preference>
    )
  }

  handleExternalPlayerPathChange (filePath) {
    dispatch('updatePreferences', 'externalPlayerPath', filePath)
  }

  autoAddTorrentsCheckbox () {
    return (
      <Preference>
        <Checkbox
          className='control'
          checked={this.props.state.saved.prefs.autoAddTorrents}
          label='Watch for new .torrent files and add them immediately'
          onCheck={(e, value) => { this.handleAutoAddTorrentsChange(e, value) }}
        />
      </Preference>
    )
  }

  handleAutoAddTorrentsChange (e, isChecked) {
    const torrentsFolderPath = this.props.state.saved.prefs.torrentsFolderPath
    if (isChecked && !torrentsFolderPath) {
      alert('Select a torrents folder first.') // eslint-disable-line
      e.preventDefault()
      return
    }

    dispatch('updatePreferences', 'autoAddTorrents', isChecked)

    if (isChecked) {
      dispatch('startFolderWatcher')
      return
    }

    dispatch('stopFolderWatcher')
  }

  torrentsFolderPathSelector () {
    const torrentsFolderPath = this.props.state.saved.prefs.torrentsFolderPath

    return (
      <Preference>
        <PathSelector
          purpose='torrentsFolderPath'
          onChange={this.handleTorrentsFolderPathChange}
          title='Folder to watch'
          value={torrentsFolderPath}
        />
      </Preference>
    )
  }

  handleTorrentsFolderPathChange (filePath) {
    dispatch('updatePreferences', 'torrentsFolderPath', filePath)
  }

  setDefaultAppButton () {
    const isFileHandler = this.props.state.saved.prefs.isFileHandler
    if (isFileHandler) {
      return (
        <Preference>
          <p>WebTorrent is your default torrent app. Hooray!</p>
        </Preference>
      )
    }
    return (
      <Preference>
        <p>WebTorrent is not currently the default torrent app.</p>
        <RaisedButton
          className='control'
          onClick={this.handleSetDefaultApp}
          label='Make WebTorrent the default'
        />
      </Preference>
    )
  }

  handleStartupChange (e, isChecked) {
    dispatch('updatePreferences', 'startup', isChecked)
  }

  setStartupCheckbox () {
    if (config.IS_PORTABLE) {
      return
    }

    return (
      <Preference>
        <Checkbox
          className='control'
          checked={this.props.state.saved.prefs.startup}
          label='Open WebTorrent on startup'
          onCheck={this.handleStartupChange}
        />
      </Preference>
    )
  }

  soundNotificationsCheckbox () {
    return (
      <Preference>
        <Checkbox
          className='control'
          checked={this.props.state.saved.prefs.soundNotifications}
          label='Enable sounds'
          onCheck={this.handleSoundNotificationsChange}
        />
      </Preference>
    )
  }

  handleSoundNotificationsChange (e, isChecked) {
    dispatch('updatePreferences', 'soundNotifications', isChecked)
  }

  handleSetDefaultApp () {
    dispatch('updatePreferences', 'isFileHandler', true)
  }

  setGlobalTrackers () {
    // Align the text fields
    const textFieldStyle = { width: '100%' }
    const textareaStyle = { margin: 0 }

    return (
      <Preference>
        <TextField
          aria-label='Additional trackers'
          className='torrent-trackers control'
          style={textFieldStyle}
          textareaStyle={textareaStyle}
          multiLine
          rows={2}
          rowsMax={10}
          value={this.state.globalTrackers}
          onChange={this.handleSetGlobalTrackers}
        />
      </Preference>
    )
  }

  handleSetGlobalTrackers (e, globalTrackers) {
    this.setState({ globalTrackers })

    const announceList = globalTrackers
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s !== '')

    dispatch('updatePreferences', 'globalTrackers', announceList)
    dispatch('updateGlobalTrackers', announceList)
  }

  render () {
    const style = {
      color: '#bdbdbd',
      marginLeft: 25,
      marginRight: 25
    }
    return (
      <div style={style}>
        <PreferencesSection title='Folders'>
          {this.downloadPathSelector()}
          {this.autoAddTorrentsCheckbox()}
          {this.torrentsFolderPathSelector()}
        </PreferencesSection>
        <PreferencesSection title='Playback'>
          {this.openExternalPlayerCheckbox()}
          {this.externalPlayerPathSelector()}
          {this.highestPlaybackPriorityCheckbox()}
        </PreferencesSection>
        <PreferencesSection title='Torrent bandwidth'>
          <p id='bandwidth-help'>Limits apply across all torrents, including playback. 0 means unlimited. 1 KiB = 1,024 bytes.</p>
          <div className='bandwidth-limits'>
            {['download', 'upload'].map(direction => (
              <label key={direction}>
                {direction === 'download' ? 'Download limit (KiB/s)' : 'Upload limit (KiB/s)'}
                <input
                  type='number' min='0' step='1' max={Math.floor(Number.MAX_SAFE_INTEGER / 1024)}
                  aria-describedby='bandwidth-help'
                  defaultValue={this.props.state.saved.prefs[direction + 'LimitKiB'] || 0}
                  onBlur={e => {
                    if (e.target.value === '') e.target.value = '0'
                    if (e.target.reportValidity()) dispatch('updatePreferences', direction + 'LimitKiB', e.target.valueAsNumber)
                  }}
                  onKeyDown={e => { if (e.key === 'Enter') e.target.blur() }}
                />
              </label>
            ))}
          </div>
          <p>Low download limits may cause buffering. Playback priority keeps these limits. The upload limit applies to sharing with torrent peers.</p>
        </PreferencesSection>
        <PreferencesSection title='Default torrent app'>
          {this.setDefaultAppButton()}
        </PreferencesSection>
        <PreferencesSection title='General'>
          {this.setStartupCheckbox()}
          {this.soundNotificationsCheckbox()}
        </PreferencesSection>
        <PreferencesSection title='Trackers'>
          {this.setGlobalTrackers()}
        </PreferencesSection>
      </div>
    )
  }
}

class PreferencesSection extends React.Component {
  static get propTypes () {
    return {
      title: PropTypes.string
    }
  }

  render () {
    const style = {
      marginBottom: 25,
      marginTop: 25
    }
    return (
      <div style={style}>
        <Heading level={2}>{this.props.title}</Heading>
        {this.props.children}
      </div>
    )
  }
}

class Preference extends React.Component {
  render () {
    const style = { marginBottom: 10 }
    return (<div style={style}>{this.props.children}</div>)
  }
}

module.exports = PreferencesPage
