const React = require('react')
const { TextField } = require('./controls')
const api = require('../lib/api')

const ModalOKCancel = require('./modal-ok-cancel')
const { dispatch, dispatcher } = require('../lib/dispatcher')
const { isMagnetLink } = require('../lib/torrent-player')

module.exports = class OpenTorrentAddressModal extends React.Component {
  render () {
    return (
      <div className='open-torrent-address-modal'>
        <p><label htmlFor='torrent-address-field'>Enter torrent address or magnet link</label></p>
        <div>
          <TextField
            id='torrent-address-field'
            className='control'
            ref={(c) => { this.torrentURL = c }}
            fullWidth
            onKeyDown={handleKeyDown.bind(this)}
          />
        </div>
        <ModalOKCancel
          cancelText='CANCEL'
          onCancel={dispatcher('exitModal')}
          okText='OK'
          onOK={handleOK.bind(this)}
        />
      </div>
    )
  }

  async componentDidMount () {
    this.torrentURL.input.focus()
    const clipboardContent = await api.clipboard.readText()
    if (!this.torrentURL || this.torrentURL.input.value) return

    if (isMagnetLink(clipboardContent)) {
      this.torrentURL.input.value = clipboardContent
      this.torrentURL.input.select()
    }
  }
}

function handleKeyDown (e) {
  if (e.which === 13) handleOK.call(this) /* hit Enter to submit */
}

function handleOK () {
  const torrentURL = this.torrentURL.input.value
  dispatch('exitModal')
  dispatch('addTorrent', torrentURL)
}
