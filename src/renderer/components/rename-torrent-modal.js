const React = require('react')
const { FlatButton, TextField } = require('./controls')
const ModalOKCancel = require('./modal-ok-cancel')
const TorrentSummary = require('../lib/torrent-summary')
const { dispatch, dispatcher } = require('../lib/dispatcher')

module.exports = class RenameTorrentModal extends React.Component {
  constructor (props) {
    super(props)
    const state = props.state
    const torrentSummary = TorrentSummary.getByKey(state, state.modal.infoHash)
    this.state = {
      value: (torrentSummary && torrentSummary.name) || ''
    }
    this.handleChange = (_, value) => this.setState({ value })
    this.handleKeyDown = e => {
      if (e.key === 'Enter') this.handleOK()
    }
    this.handleOK = () => {
      dispatch('renameTorrent', state.modal.infoHash, this.state.value)
      dispatch('exitModal')
    }
    this.handleReset = () => {
      dispatch('renameTorrent', state.modal.infoHash, '')
      dispatch('exitModal')
    }
  }

  render () {
    const state = this.props.state
    const torrentSummary = TorrentSummary.getByKey(state, state.modal.infoHash)
    const originalName = (torrentSummary && (torrentSummary.originalName || torrentSummary.name)) || ''

    return (
      <div className='rename-torrent-modal'>
        <p><label htmlFor='torrent-rename-field'>Rename torrent</label></p>
        <div>
          <TextField
            id='torrent-rename-field'
            className='control'
            ref={c => { this.nameField = c }}
            value={this.state.value}
            fullWidth
            onChange={this.handleChange}
            onKeyDown={this.handleKeyDown}
          />
        </div>
        <p className='original-name'>
          Original name: <span>{originalName}</span>
        </p>
        <div className='modal-actions'>
          <FlatButton
            className='control reset-name'
            label='Use original'
            onClick={this.handleReset}
          />
          <ModalOKCancel
            cancelText='Cancel'
            onCancel={dispatcher('exitModal')}
            okText='Save'
            onOK={this.handleOK}
          />
        </div>
      </div>
    )
  }

  componentDidMount () {
    if (this.nameField && this.nameField.input) {
      this.nameField.input.focus()
      this.nameField.input.select()
    }
  }
}
