const React = require('react')
const PropTypes = require('prop-types')

class Heading extends React.Component {
  static get propTypes () {
    return {
      level: PropTypes.number
    }
  }

  static get defaultProps () {
    return {
      level: 1
    }
  }

  render () {
    const HeadingTag = 'h' + this.props.level
    const style = {
      color: '#f5f5f5',
      fontSize: 20,
      marginBottom: 15,
      marginTop: 30
    }
    return (
      <HeadingTag style={style}>
        {this.props.children}
      </HeadingTag>
    )
  }
}

module.exports = Heading
